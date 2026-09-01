#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const terminalFailures = new Set(["failed", "skipped"]);
const pendingStatuses = new Set(["pending", "in-progress"]);

export function classifyPromotion({ request, productionAliases, aliases, inventoryComplete, deploymentId, rollbackAliases }) {
  const exactRequest = request?.type === "promote" && request?.toDeploymentId === deploymentId;
  const completedAliases = aliases.filter((item) => item.status === "completed");
  const exactProductionAliases = productionAliases.length > 0 && productionAliases.every((item) => item.deploymentId === deploymentId);
  const exactPromotionAliases = aliases.length === productionAliases.length && productionAliases.every((current) =>
    aliases.some((item) => item.alias === current.alias && item.status === "completed"));
  if (exactRequest && request.jobStatus === "succeeded" && inventoryComplete && exactProductionAliases && exactPromotionAliases) {
    return "promoted";
  }
  if (exactRequest && pendingStatuses.has(request.jobStatus)) return "pending";
  const rollbackMap = new Map(rollbackAliases.map((item) => [item.alias, item.deployment_id]));
  const exactRollbackAliases = productionAliases.length > 0 && productionAliases.length === rollbackMap.size &&
    productionAliases.every((item) => rollbackMap.get(item.alias) === item.deploymentId);
  if (exactRequest && terminalFailures.has(request.jobStatus) && inventoryComplete && exactRollbackAliases && completedAliases.length === 0) {
    return "not_promoted";
  }
  return "promotion_uncertain";
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sanitizeAliases = (payload) => {
  if (!Array.isArray(payload?.aliases) || !payload?.pagination) return null;
  const aliases = payload.aliases.map((item) => ({
    alias: item?.alias || null,
    id: item?.id || null,
    status: item?.status || null,
  }));
  if (aliases.some((item) => !item.alias || !item.id || !item.status) ||
      new Set(aliases.map((item) => item.alias)).size !== aliases.length) return null;
  return aliases;
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
  const domainNames = (Array.isArray(domainsPayload?.domains) ? domainsPayload.domains : []).map((domain) => domain?.name).filter(Boolean);
  const productionAliasNames = [...new Set([intent.expected_production_alias, ...domainNames])].sort();
  const rollbackAliasNames = rollbackAliases.map((item) => item.alias).sort();
  const exactAliasInventory = productionAliasNames.length === rollbackAliasNames.length &&
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
  const promoteAliasesPayload = await fetchJson(`/v1/projects/${encodedProjectId}/promote/aliases?limit=100&${query}`, token, fetchImpl);
  const aliases = sanitizeAliases(promoteAliasesPayload);
  const request = project.lastAliasRequest || null;
  const inventoryComplete = Boolean(domainsPayload?.pagination && !domainsPayload.pagination.next &&
    promoteAliasesPayload?.pagination && !promoteAliasesPayload.pagination.next && aliases && exactAliasInventory &&
    productionAliases.every((item) => item.projectName === intent.project_name && item.target === "production" && item.readyState === "READY"));
  const promotionState = classifyPromotion({
    request,
    productionAliases,
    aliases: aliases || [],
    inventoryComplete,
    deploymentId: intent.deployment_id,
    rollbackAliases,
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
  do {
    try {
      const snapshot = await readPromotionSnapshot({ intent, token, teamId, fetchImpl });
      promotionState = snapshot.promotionState;
      lastEvidence = snapshot.provider;
      providerError = null;
      if (promotionState === "promoted" || promotionState === "not_promoted") break;
    } catch (error) {
      providerError = error instanceof Error ? error.message.slice(0, 200) : "unknown reconciliation error";
    }
    if (now() >= deadline) break;
    await sleepImpl(pollMs);
  } while (now() <= deadline);
  if (promotionState === "pending") promotionState = "promotion_uncertain";
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
