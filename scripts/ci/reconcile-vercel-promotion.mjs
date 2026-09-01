#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const terminalFailures = new Set(["failed", "skipped"]);
const pendingStatuses = new Set(["pending", "in-progress"]);
const terminalAliasFailures = new Set(["failed", "skipped"]);

export function classifyPromotion({ request, productionAliases, aliases, inventoryComplete, deploymentId, rollbackAliases, lastAliasRequestExpired = false }) {
  if (!Array.isArray(productionAliases) || !Array.isArray(aliases) || !Array.isArray(rollbackAliases)) {
    return "promotion_uncertain";
  }
  const exactRequest = request?.type === "promote" && request?.toDeploymentId === deploymentId;
  const exactProductionAliases = productionAliases.length > 0 && productionAliases.every((item) => item.deploymentId === deploymentId);
  const exactPromotionAliases = aliases.length === productionAliases.length && productionAliases.every((current) =>
    aliases.some((item) => item.alias === current.alias && item.status === "completed"));
  const completedRequest = exactRequest && request.jobStatus === "succeeded";
  const completedRequestExpired = lastAliasRequestExpired === true && request === null;
  if ((completedRequest || completedRequestExpired) && inventoryComplete && exactProductionAliases && exactPromotionAliases) {
    return "promoted";
  }
  if (exactRequest && pendingStatuses.has(request.jobStatus)) return "pending";
  const rollbackMap = new Map(rollbackAliases.map((item) => [item.alias, item.deployment_id]));
  const exactRollbackAliases = productionAliases.length > 0 && productionAliases.length === rollbackMap.size &&
    productionAliases.every((item) => rollbackMap.get(item.alias) === item.deploymentId);
  const aliasesDefinitelyFailed = aliases.length === 0 || aliases.every((item) => terminalAliasFailures.has(item?.status));
  if (exactRequest && terminalFailures.has(request.jobStatus) && inventoryComplete && exactRollbackAliases && aliasesDefinitelyFailed) {
    return "not_promoted";
  }
  return "promotion_uncertain";
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasCompletePagination = (payload) => isRecord(payload) && hasOwn(payload, "pagination") && isRecord(payload.pagination) &&
  hasOwn(payload.pagination, "next") && payload.pagination.next === null;
const sanitizeAliases = (payload) => {
  if (!isRecord(payload) || !hasOwn(payload, "aliases") || !Array.isArray(payload.aliases) || !hasCompletePagination(payload)) return null;
  const aliases = payload.aliases.map((item) => ({
    alias: isRecord(item) && typeof item.alias === "string" && item.alias.length > 0 ? item.alias : null,
    id: isRecord(item) && typeof item.id === "string" && item.id.length > 0 ? item.id : null,
    status: isRecord(item) && typeof item.status === "string" && item.status.length > 0 ? item.status : null,
  }));
  if (aliases.some((item) => !item.alias || !item.id || !item.status) ||
      new Set(aliases.map((item) => item.alias)).size !== aliases.length) return null;
  return aliases.sort((left, right) => left.alias.localeCompare(right.alias));
};
const sanitizeDomains = (payload) => {
  if (!isRecord(payload) || !hasOwn(payload, "domains") || !Array.isArray(payload.domains) || !hasCompletePagination(payload)) return null;
  const names = payload.domains.map((item) =>
    isRecord(item) && typeof item.name === "string" && item.name.length > 0 ? item.name : null);
  if (names.some((name) => name === null) || new Set(names).size !== names.length) return null;
  return names;
};

const sanitizeLastAliasRequest = (project) => {
  if (!isRecord(project) || !hasOwn(project, "lastAliasRequest")) {
    return { request: undefined, expired: false };
  }
  if (project.lastAliasRequest === null) return { request: null, expired: true };
  if (!isRecord(project.lastAliasRequest)) return { request: undefined, expired: false };
  const candidate = project.lastAliasRequest;
  if (!hasOwn(candidate, "type") || !hasOwn(candidate, "toDeploymentId") || !hasOwn(candidate, "jobStatus") ||
      typeof candidate.type !== "string" || candidate.type.length === 0 ||
      typeof candidate.toDeploymentId !== "string" || candidate.toDeploymentId.length === 0 ||
      typeof candidate.jobStatus !== "string" || candidate.jobStatus.length === 0) {
    return { request: undefined, expired: false };
  }
  return { request: candidate, expired: false };
};

async function fetchJson(path, token, fetchImpl) {
  const response = await fetchImpl(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Vercel reconciliation request failed with HTTP ${response.status}`);
  return response.json();
}

export async function readPromotionSnapshot({ intent, token, teamId, fetchImpl = fetch }) {
  const rollbackInventory = intent?.rollback_inventory;
  const rollbackAliases = rollbackInventory?.aliases;
  if (!Array.isArray(rollbackAliases) || rollbackAliases.length === 0 ||
      rollbackAliases.some((item) => !item?.alias || !/^dpl_[A-Za-z0-9]+$/.test(item?.deployment_id || "")) ||
      new Set(rollbackAliases.map((item) => item.alias)).size !== rollbackAliases.length ||
      rollbackInventory.inventory_complete !== true || rollbackInventory.project_id !== intent.project_id ||
      !intent.org_id || rollbackInventory.org_id !== intent.org_id || teamId !== intent.org_id ||
      rollbackInventory.project_name !== intent.project_name ||
      rollbackInventory.expected_production_alias !== intent.expected_production_alias ||
      rollbackInventory.deployment_id !== intent.rollback_deployment_id ||
      rollbackAliases.some((item) => item.deployment_id !== rollbackInventory.deployment_id)) {
    throw new Error("Immutable rollback alias inventory is missing or invalid");
  }
  const query = `teamId=${encodeURIComponent(teamId)}`;
  const encodedProjectId = encodeURIComponent(intent.project_id);
  const project = await fetchJson(`/v9/projects/${encodedProjectId}?${query}`, token, fetchImpl);
  if (project.id !== intent.project_id || project.name !== intent.project_name ||
      project.accountId !== intent.org_id || project.link != null) {
    throw new Error("Vercel project identity changed during reconciliation");
  }
  const domainsPayload = await fetchJson(`/v9/projects/${encodedProjectId}/domains?limit=100&${query}`, token, fetchImpl);
  const domainNames = sanitizeDomains(domainsPayload);
  const promoteAliasesPayload = await fetchJson(`/v1/projects/${encodedProjectId}/promote/aliases?limit=100&${query}`, token, fetchImpl);
  const aliases = sanitizeAliases(promoteAliasesPayload);
  const productionAliasNames = [...new Set([intent.expected_production_alias, ...(domainNames || [])])].sort();
  const rollbackAliasNames = rollbackAliases.map((item) => item.alias).sort();
  const exactAliasInventory = Boolean(domainNames) && productionAliasNames.length === rollbackAliasNames.length &&
    productionAliasNames.every((alias, index) => alias === rollbackAliasNames[index]);
  const productionAliases = await Promise.all(productionAliasNames.map(async (alias) => {
    const deployment = await fetchJson(`/v13/deployments/${encodeURIComponent(alias)}?${query}`, token, fetchImpl);
    return {
      alias,
      deploymentId: deployment.id || null,
      projectName: deployment.name || null,
      target: deployment.target || null,
      readyState: deployment.readyState || null,
    };
  }));
  const { request, expired: lastAliasRequestExpired } = sanitizeLastAliasRequest(project);
  const inventoryComplete = Boolean(domainNames && aliases && exactAliasInventory &&
    productionAliases.every((item) => item.projectName === intent.project_name && item.target === "production" && item.readyState === "READY"));
  const promotionState = classifyPromotion({
    request,
    productionAliases,
    aliases: aliases || [],
    inventoryComplete,
    deploymentId: intent.deployment_id,
    rollbackAliases,
    lastAliasRequestExpired,
  });
  return {
    promotionState,
    provider: {
      project_id: project.id,
      project_name: project.name,
      org_id: project.accountId,
      inventory_complete: inventoryComplete,
      production_aliases: productionAliases,
      rollback_aliases: rollbackAliases,
      job_status: request?.jobStatus || null,
      requested_at: request?.requestedAt || null,
      to_deployment_id: request?.toDeploymentId || null,
      type: request?.type || null,
      aliases: aliases || [],
      last_alias_request_expired: lastAliasRequestExpired,
    },
  };
}

export async function reconcilePromotion({
  intent,
  token,
  teamId,
  fetchImpl = fetch,
  now = Date.now,
  sleepImpl = sleep,
  timeoutMs = 120_000,
  pollMs = 5_000,
}) {
  const deadline = now() + timeoutMs;
  let promotionState = "promotion_uncertain";
  let lastEvidence = null;
  let providerError = null;
  let promotedFingerprint = null;
  let promotionConfirmed = false;
  do {
    try {
      const snapshot = await readPromotionSnapshot({ intent, token, teamId, fetchImpl });
      promotionState = snapshot.promotionState;
      lastEvidence = snapshot.provider;
      providerError = null;
      if (promotionState === "promoted") {
        const fingerprint = JSON.stringify({
          production_aliases: snapshot.provider.production_aliases,
          aliases: snapshot.provider.aliases,
          job_status: snapshot.provider.job_status,
          to_deployment_id: snapshot.provider.to_deployment_id,
          type: snapshot.provider.type,
          last_alias_request_expired: snapshot.provider.last_alias_request_expired,
        });
        if (promotedFingerprint === fingerprint) {
          promotionConfirmed = true;
          break;
        }
        promotedFingerprint = fingerprint;
      } else {
        promotedFingerprint = null;
      }
      if (promotionState === "not_promoted") break;
    } catch (error) {
      providerError = error instanceof Error ? error.message.slice(0, 200) : "unknown reconciliation error";
      promotionState = "promotion_uncertain";
      promotedFingerprint = null;
    }
    if (now() >= deadline) break;
    await sleepImpl(pollMs);
  } while (now() <= deadline);
  if (promotionState === "pending" || (promotionState === "promoted" && !promotionConfirmed)) {
    promotionState = "promotion_uncertain";
  }
  return { promotionState, lastEvidence, providerError };
}

async function main() {
  const [intentPath, evidencePath] = process.argv.slice(2);
  const token = process.env.VERCEL_TOKEN || "";
  const teamId = process.env.VERCEL_ORG_ID || "";
  const intent = JSON.parse(readFileSync(intentPath, "utf8"));
  if (!token || !teamId || !evidencePath) throw new Error("Vercel reconciliation configuration is incomplete");
  const { promotionState, lastEvidence, providerError } = await reconcilePromotion({ intent, token, teamId });
  const operatorAction = promotionState === "promoted"
    ? "none"
    : `Do not retry promotion blindly. Inspect deployment ${intent.deployment_id} and alias ${intent.expected_production_alias}; if rollback is required, use only ${intent.rollback_deployment_id}.`;
  const finalEvidence = {
    ...intent,
    status: "reconciled",
    promotion_state: promotionState,
    promote_cli_exit_code: Number.parseInt(process.env.CLI_EXIT_CODE || "124", 10),
    reconciled_at: new Date().toISOString(),
    provider: lastEvidence,
    provider_error: providerError,
    operator_action: operatorAction,
  };
  writeFileSync(evidencePath, `${JSON.stringify(finalEvidence)}\n`);
  if (promotionState !== "promoted") {
    console.error(`Vercel promotion is fail-closed as ${promotionState}. ${operatorAction}`);
    process.exitCode = 1;
  } else {
    console.log(`Reconciled exact promoted deployment ${intent.deployment_id}.`);
  }
}

if (process.argv[1]?.endsWith("reconcile-vercel-promotion.mjs")) await main();
