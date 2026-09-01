#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const API_BASE = "https://api.vercel.com";

async function fetchJson(path, token, fetchImpl) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Vercel rollback inventory request failed with HTTP ${response.status}`);
  return response.json();
}

export async function captureRollbackInventory({
  token,
  teamId,
  expectedOrgId,
  projectId,
  projectName,
  expectedProductionAlias,
  fetchImpl = fetch,
}) {
  if (!token || !teamId || !expectedOrgId || !projectId || !projectName || !expectedProductionAlias || teamId !== expectedOrgId) {
    throw new Error("Vercel rollback inventory configuration is incomplete");
  }
  const query = `teamId=${encodeURIComponent(teamId)}`;
  const encodedProjectId = encodeURIComponent(projectId);
  const project = await fetchJson(`/v9/projects/${encodedProjectId}?${query}`, token, fetchImpl);
  if (project.id !== projectId || project.name !== projectName || project.accountId !== expectedOrgId || project.link != null) {
    throw new Error("Vercel rollback inventory project identity is not the dedicated non-Git project");
  }

  const domainsPayload = await fetchJson(`/v9/projects/${encodedProjectId}/domains?limit=100&${query}`, token, fetchImpl);
  if (!Array.isArray(domainsPayload?.domains) || !domainsPayload?.pagination || domainsPayload.pagination.next) {
    throw new Error("Vercel production-domain inventory is incomplete or paginated");
  }
  const domainNames = domainsPayload.domains.map((domain) => domain?.name);
  if (domainNames.some((name) => typeof name !== "string" || !name) || new Set(domainNames).size !== domainNames.length) {
    throw new Error("Vercel production-domain inventory contains an invalid or duplicate domain");
  }
  const aliasNames = [...new Set([expectedProductionAlias, ...domainNames])].sort();
  const aliases = await Promise.all(aliasNames.map(async (alias) => {
    const deployment = await fetchJson(`/v13/deployments/${encodeURIComponent(alias)}?${query}`, token, fetchImpl);
    if (!/^dpl_[A-Za-z0-9]+$/.test(deployment?.id || "") || deployment.name !== projectName ||
        deployment.target !== "production" || deployment.readyState !== "READY") {
      throw new Error(`Vercel production alias ${alias} is not a ready deployment of the dedicated project`);
    }
    return { alias, deployment_id: deployment.id };
  }));
  const rollbackDeploymentIds = new Set(aliases.map((alias) => alias.deployment_id));
  if (rollbackDeploymentIds.size !== 1) {
    throw new Error("Vercel production aliases do not share one safe rollback deployment");
  }

  return {
    schema: 1,
    org_id: expectedOrgId,
    project_id: projectId,
    project_name: projectName,
    expected_production_alias: expectedProductionAlias,
    inventory_complete: true,
    deployment_id: aliases[0].deployment_id,
    aliases,
  };
}

async function main() {
  const [outputPath] = process.argv.slice(2);
  if (!outputPath) throw new Error("A rollback inventory output path is required");
  const inventory = await captureRollbackInventory({
    token: process.env.VERCEL_TOKEN || "",
    teamId: process.env.VERCEL_ORG_ID || "",
    expectedOrgId: process.env.EXPECTED_VERCEL_ORG_ID || "",
    projectId: process.env.VERCEL_PROJECT_ID || "",
    projectName: process.env.EXPECTED_VERCEL_PROJECT_NAME || "",
    expectedProductionAlias: process.env.EXPECTED_PRODUCTION_ALIAS || "",
  });
  writeFileSync(outputPath, `${JSON.stringify(inventory)}\n`, { flag: "wx" });
}

if (process.argv[1]?.endsWith("capture-vercel-rollback.mjs")) await main();
