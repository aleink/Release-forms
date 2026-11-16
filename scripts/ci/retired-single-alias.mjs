#!/usr/bin/env node
// This publisher cannot promote a project, change a domain, or select a sibling.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TARGET = Object.freeze({
  orgId: "team_dYh8hnyuxB6dbWOjq34jIHNg",
  projectId: "prj_AgFYzaxmaGGuLPQnxkeSfzLawwMX",
  projectName: "release-forms",
  alias: "release-forms.vercel.app",
  priorDeploymentId: "dpl_FCoyQZDaUzE1dEpcGiQqm6MfjqJ2",
  priorSourceSha: "1765d25ea2c9e43eb75033127b331be33aaa80c3",
  repository: "aleink/Release-forms",
});
const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const DPL = /^dpl_[A-Za-z0-9]+$/;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const jsonDigest = value => digest(JSON.stringify(canonical(value)));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const read = path => JSON.parse(readFileSync(path, "utf8"));

export function apiClient(token, fetchImpl = fetch) {
  assert(typeof token === "string" && token.length > 0, "Vercel credential is missing");
  return async (path, body) => {
    // The caller never supplies a host. No redirect may receive this credential.
    assert(path.startsWith("/v") && !path.includes("#"), "Unexpected provider path");
    const url = new URL(path, "https://api.vercel.com");
    url.searchParams.set("teamId", TARGET.orgId);
    let response;
    try {
      response = await fetchImpl(url, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error", signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new Error("Provider request failed or timed out; do not blindly retry a mutation"); }
    assert(response.ok, `Provider request returned HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    assert(bytes.byteLength <= 2 * 1024 * 1024, "Provider response exceeds bound");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error("Provider returned malformed JSON"); }
  };
}

function aliasRow(row) {
  assert(row && typeof row.alias === "string" && /^[a-z0-9.-]+$/.test(row.alias) &&
    typeof row.uid === "string" && row.uid.length > 0 && row.projectId === TARGET.projectId &&
    DPL.test(row.deploymentId ?? "") && (row.deployment == null || row.deployment.id === row.deploymentId) &&
    row.deletedAt == null && row.microfrontends == null, "Unexpected alias identity or routing");
  assert(row.redirect == null || typeof row.redirect === "string", "Malformed alias redirect");
  assert(row.redirectStatusCode == null || [301, 302, 307, 308].includes(row.redirectStatusCode), "Malformed redirect status");
  return { alias: row.alias, uid: row.uid, projectId: row.projectId, deploymentId: row.deploymentId,
    redirect: row.redirect ?? null, redirectStatusCode: row.redirectStatusCode ?? null,
    protection_sha256: jsonDigest(row.protectionBypass ?? null) };
}

function validateSnapshot(snapshot) {
  assert(snapshot?.schema === 1 && snapshot.org_id === TARGET.orgId && snapshot.project_id === TARGET.projectId &&
    snapshot.primary_alias === TARGET.alias && snapshot.complete === true &&
    HASH.test(snapshot.project_config_sha256 ?? "") && Array.isArray(snapshot.aliases) &&
    snapshot.aliases.length > 0 && snapshot.aliases.length <= 100, "Invalid complete alias snapshot");
  const names = snapshot.aliases.map(row => row.alias);
  assert(new Set(names).size === names.length && equal(names, [...names].sort()), "Duplicate or unsorted alias snapshot");
  for (const row of snapshot.aliases) {
    assert(row.projectId === TARGET.projectId && DPL.test(row.deploymentId ?? "") &&
      typeof row.uid === "string" && row.uid.length > 0 && HASH.test(row.protection_sha256 ?? ""), "Invalid saved alias identity");
  }
  const primary = snapshot.aliases.find(row => row.alias === TARGET.alias);
  assert(primary && primary.redirect === null && primary.redirectStatusCode === null, "Primary alias must be a direct mapping");
  return primary;
}

export async function captureAliases(api) {
  const project = await api(`/v9/projects/${TARGET.projectId}`);
  assert(project.id === TARGET.projectId && project.accountId === TARGET.orgId && project.name === TARGET.projectName,
    "Wrong retired project or team");
  assert(project.link == null, "Disconnect ONLY the retired project's Git integration before staging or publishing");
  const listing = await api(`/v4/aliases?projectId=${TARGET.projectId}&limit=100`);
  // Fail closed instead of silently truncating. Current project has fewer than 100 aliases.
  assert(Array.isArray(listing.aliases) && listing.pagination?.next === null &&
    listing.pagination.count === listing.aliases.length && listing.aliases.length <= 100, "Alias inventory is incomplete or paginated");
  const aliases = listing.aliases.map(aliasRow).sort((a, b) => a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0);
  const primary = aliasRow(await api(`/v4/aliases/${TARGET.alias}?projectId=${TARGET.projectId}`));
  assert(equal(primary, aliases.find(row => row.alias === TARGET.alias)), "Alias detail disagrees with complete inventory");
  // No access values are persisted. Project-wide protection and bypass registry
  // remain pinned. A future separately approved deployment-scoped share entry
  // must NOT change this registry, another deployment, or any sibling alias.
  const config = Object.fromEntries(["link", "ssoProtection", "passwordProtection", "trustedIps", "protectionBypass", "deploymentProtection", "autoAssignCustomDomains"]
    .map(key => [key, project[key] ?? null]));
  const snapshot = { schema: 1, org_id: TARGET.orgId, project_id: TARGET.projectId,
    primary_alias: TARGET.alias, complete: true, project_config_sha256: jsonDigest(config), aliases };
  validateSnapshot(snapshot);
  return snapshot;
}

export function compareAliases(before, after, expectedPrimaryDeployment) {
  validateSnapshot(before); validateSnapshot(after);
  assert(before.project_config_sha256 === after.project_config_sha256, "Project access configuration changed");
  const expected = structuredClone(before.aliases);
  expected.find(row => row.alias === TARGET.alias).deploymentId = expectedPrimaryDeployment;
  assert(equal(expected, after.aliases), "Alias drift: a sibling, redirect, identity, or unexpected primary mapping changed");
  return true;
}

async function deployment(api, id, sourceSha, url, prebuilt) {
  assert(DPL.test(id ?? ""), "Invalid deployment ID");
  const d = await api(`/v13/deployments/${id}`);
  assert(d.id === id && d.projectId === TARGET.projectId && d.ownerId === TARGET.orgId && d.name === TARGET.projectName &&
    d.target === "production" && d.readyState === "READY", "Deployment is not the exact READY production artifact in the retired project");
  assert((d.meta?.githubCommitSha ?? d.meta?.gitCommitSha) === sourceSha, "Deployment source SHA differs");
  if (url) assert(`https://${d.url}` === url && d.prebuilt === prebuilt, "Candidate URL or prebuilt identity differs");
  return d;
}

export function validateIntent(intent) {
  assert(intent?.schema === 1 && intent.operation === "retired-primary-alias-only" && intent.repository === TARGET.repository &&
    intent.org_id === TARGET.orgId && intent.project_id === TARGET.projectId && intent.alias === TARGET.alias &&
    intent.rollback_deployment_id === TARGET.priorDeploymentId && SHA.test(intent.sha ?? "") &&
    DPL.test(intent.deployment_id ?? "") && intent.deployment_id !== TARGET.priorDeploymentId &&
    /^https:\/\/release-forms-[a-z0-9-]+\.vercel\.app$/.test(intent.deployment_url ?? "") &&
    HASH.test(intent.provider_inventory_sha256 ?? "") && HASH.test(intent.artifact_sha256 ?? "") &&
    /^\d+$/.test(intent.run_id ?? ""), "Invalid pinned single-alias intent");
  assert(validateSnapshot(intent.baseline).deploymentId === TARGET.priorDeploymentId, "Rollback is not the exact approved prior mapping");
  assert(jsonDigest(intent.baseline) === intent.baseline_sha256, "Baseline snapshot hash differs");
  return intent;
}

export function createIntent({ baseline, inventory, inventoryBytes, sha, runId, artifactSha256 }) {
  assert(inventory?.schema === 1 && inventory.complete === true && inventory.source === "vercel-v6-deployment-files" &&
    inventory.org_id === TARGET.orgId && inventory.project_id === TARGET.projectId && inventory.project_name === TARGET.projectName,
  "Unbound provider file inventory");
  return validateIntent({ schema: 1, operation: "retired-primary-alias-only", repository: TARGET.repository,
    org_id: TARGET.orgId, project_id: TARGET.projectId, alias: TARGET.alias, sha, run_id: runId,
    deployment_id: inventory.deployment_id, deployment_url: inventory.deployment_url,
    rollback_deployment_id: TARGET.priorDeploymentId, baseline, baseline_sha256: jsonDigest(baseline),
    provider_inventory_sha256: digest(inventoryBytes), artifact_sha256: artifactSha256 });
}

export function validateCanary(intent, canary) {
  validateIntent(intent);
  assert(canary?.schema === 2 && canary.runtime === "inactive" && canary.exact_bytes === true && canary.exact_headers === true &&
    canary.provider_inventory_complete === true && canary.provider_inventory_sha256 === intent.provider_inventory_sha256 &&
    canary.org_id === TARGET.orgId && canary.project_id === TARGET.projectId && canary.deployment_id === intent.deployment_id &&
    canary.deployment_url === intent.deployment_url && canary.headerCount === 10 &&
    equal(canary.routes, ["/", "/client", "/staff"]) && equal(canary.additional_routes, ["/formtest", "/manager"]),
  "Exact inactive HTTP canary has not passed for this deployment");
}

export async function checkIntent(api, intent, expectedPrimaryDeployment) {
  validateIntent(intent);
  await deployment(api, TARGET.priorDeploymentId, TARGET.priorSourceSha);
  await deployment(api, intent.deployment_id, intent.sha, intent.deployment_url, true);
  const actual = await captureAliases(api);
  compareAliases(intent.baseline, actual, expectedPrimaryDeployment);
  return actual;
}

export async function assignPrimary({ api, intent, canary, confirmation, rollback = false, recordAttempt = () => {} }) {
  validateIntent(intent);
  assert(confirmation === `${rollback ? "ROLLBACK" : "CHANGE"} ONLY ${TARGET.alias}`, "Explicit single-alias confirmation is required");
  if (!rollback) validateCanary(intent, canary);
  await checkIntent(api, intent, rollback ? intent.deployment_id : TARGET.priorDeploymentId);
  const destination = rollback ? TARGET.priorDeploymentId : intent.deployment_id;
  // Persist before the only mutation. There is no API CAS or automatic retry.
  recordAttempt({ schema: 1, operation: rollback ? "rollback" : "assign", alias: TARGET.alias,
    destination, intent_sha256: jsonDigest(intent), status: "attempt_started", at: new Date().toISOString() });
  let accepted = false;
  try {
    const response = await api(`/v2/deployments/${destination}/aliases`, { alias: TARGET.alias, redirect: null });
    accepted = response.alias === TARGET.alias && typeof response.uid === "string";
  } catch { /* The always-run reconciliation must determine state; never resend. */ }
  const actual = await captureAliases(api);
  compareAliases(intent.baseline, actual, destination);
  assert(accepted, "Alias mapping reconciled, but mutation response was uncertain; review evidence without retrying");
  return { schema: 1, status: rollback ? "rolled_back" : "alias_assigned", alias: TARGET.alias,
    deployment_id: destination, siblings_unchanged: true, snapshot: actual, intent_sha256: jsonDigest(intent) };
}

export async function reconcile(api, intent) {
  validateIntent(intent);
  const actual = await captureAliases(api);
  const current = validateSnapshot(actual).deploymentId;
  assert([TARGET.priorDeploymentId, intent.deployment_id].includes(current), "Primary mapping is unexpected; do not retry or roll back blindly");
  compareAliases(intent.baseline, actual, current);
  return { schema: 1, status: current === intent.deployment_id ? "candidate_mapped" : "prior_mapping_unchanged",
    alias: TARGET.alias, deployment_id: current, siblings_unchanged: true,
    intent_sha256: jsonDigest(intent), snapshot: actual };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const api = () => apiClient(process.env.VERCEL_TOKEN);
  if (command === "snapshot") {
    const snapshot = await captureAliases(api());
    assert(validateSnapshot(snapshot).deploymentId === TARGET.priorDeploymentId, "Primary mapping has changed since approval");
    await deployment(api(), TARGET.priorDeploymentId, TARGET.priorSourceSha);
    write(args[0], snapshot);
  } else if (command === "intent") {
    const [baselinePath, inventoryPath, outputPath] = args;
    const inventoryBytes = readFileSync(inventoryPath);
    write(outputPath, createIntent({ baseline: read(baselinePath), inventory: JSON.parse(inventoryBytes), inventoryBytes,
      sha: process.env.RELEASE_SHA?.toLowerCase(), runId: process.env.GITHUB_RUN_ID, artifactSha256: process.env.ARTIFACT_DIGEST }));
  } else if (command === "check") {
    await checkIntent(api(), read(args[0]), TARGET.priorDeploymentId);
  } else if (command === "assign" || command === "rollback") {
    const [intentPath, canaryPath, attemptPath, resultPath] = args;
    write(resultPath, await assignPrimary({ api: api(), intent: read(intentPath),
      canary: command === "assign" ? read(canaryPath) : null, rollback: command === "rollback",
      confirmation: process.env.SINGLE_ALIAS_CONFIRMATION, recordAttempt: attempt => write(attemptPath, attempt) }));
  } else if (command === "reconcile") {
    write(args[1], await reconcile(api(), read(args[0])));
  } else throw new Error("Expected snapshot, intent, check, assign, reconcile, or explicitly approved rollback");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
