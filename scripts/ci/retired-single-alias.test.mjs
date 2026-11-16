import assert from "node:assert/strict";
import test from "node:test";
import { TARGET, apiClient, captureAliases, createIntent, compareAliases, validateCanary, assignPrimary, reconcile } from "./retired-single-alias.mjs";

const sha = "a".repeat(40), candidate = "dpl_Candidate", url = "https://release-forms-candidate-gemandi.vercel.app";
const clone = value => structuredClone(value);
const row = (alias, deploymentId) => ({ alias, deploymentId, deployment: { id: deploymentId },
  projectId: TARGET.projectId, uid: `uid-${alias}`, deletedAt: null, redirect: null, redirectStatusCode: null });
function provider() {
  const state = {
    project: { id: TARGET.projectId, accountId: TARGET.orgId, name: TARGET.projectName, link: null, ssoProtection: { deploymentType: "all_except_custom_domains" } },
    aliases: [row(TARGET.alias, TARGET.priorDeploymentId), row("release-forms-gemandi.vercel.app", TARGET.priorDeploymentId),
      row("release-forms-git-main-gemandi.vercel.app", "dpl_DifferentSibling")],
    requests: [], posts: [], paginationNext: null, failPost: false, failBeforePost: false, acceptedThenTimeout: false,
    candidate: { id: candidate, projectId: TARGET.projectId, ownerId: TARGET.orgId, name: TARGET.projectName,
      target: "production", readyState: "READY", prebuilt: true, url: url.slice(8), meta: { githubCommitSha: sha } },
  };
  const api = async (path, body) => {
    state.requests.push({ path, body });
    if (body) {
      state.posts.push({ path, body });
      if (state.failPost) throw Error("fixture uncertain send");
      assert.match(path, /^\/v2\/deployments\/dpl_[a-zA-Z0-9]+\/aliases$/);
      assert.deepEqual(body, { alias: TARGET.alias, redirect: null });
      const id = path.split("/")[3];
      const primary = state.aliases.find(x => x.alias === TARGET.alias);
      primary.deploymentId = id; primary.deployment.id = id;
      if (state.acceptedThenTimeout) throw Error("fixture response timeout");
      return { alias: TARGET.alias, uid: primary.uid };
    }
    if (path.startsWith("/v9/projects/")) return clone(state.project);
    if (path.startsWith("/v4/aliases?")) return { aliases: clone(state.aliases), pagination: { count: state.aliases.length, next: state.paginationNext } };
    if (path.startsWith("/v4/aliases/")) return clone(state.aliases.find(x => x.alias === TARGET.alias));
    if (path === `/v13/deployments/${candidate}`) return clone(state.candidate);
    if (path === `/v13/deployments/${TARGET.priorDeploymentId}`) return { ...clone(state.candidate), id: TARGET.priorDeploymentId, meta: { githubCommitSha: TARGET.priorSourceSha } };
    throw Error(`Unexpected fixture endpoint: ${path}`);
  };
  return { state, api };
}
async function prepared() {
  const { state, api } = provider();
  const baseline = await captureAliases(api);
  const inventory = { schema: 1, complete: true, source: "vercel-v6-deployment-files", org_id: TARGET.orgId,
    project_id: TARGET.projectId, project_name: TARGET.projectName, deployment_id: candidate, deployment_url: url };
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  const intent = createIntent({ baseline, inventory, inventoryBytes, sha, runId: "123", artifactSha256: "b".repeat(64) });
  const canary = { schema: 2, runtime: "inactive", exact_bytes: true, exact_headers: true, provider_inventory_complete: true,
    provider_inventory_sha256: intent.provider_inventory_sha256, org_id: TARGET.orgId, project_id: TARGET.projectId,
    deployment_id: candidate, deployment_url: url, headerCount: 10, routes: ["/", "/client", "/staff"], additional_routes: ["/formtest", "/manager"] };
  return { state, api, baseline, intent, canary, confirmation: `CHANGE ONLY ${TARGET.alias}` };
}

test("moves only the primary alias and preserves siblings with DIFFERENT prior deployments", async () => {
  const f = await prepared(); let attempt;
  const result = await assignPrimary({ ...f, recordAttempt: value => { attempt = value; } });
  assert.equal(result.status, "alias_assigned");
  assert.equal(attempt.status, "attempt_started");
  assert.deepEqual(f.state.posts, [{ path: `/v2/deployments/${candidate}/aliases`, body: { alias: TARGET.alias, redirect: null } }]);
  assert.equal(f.state.aliases[1].deploymentId, TARGET.priorDeploymentId);
  assert.equal(f.state.aliases[2].deploymentId, "dpl_DifferentSibling");
});
test("rollback restores ONLY the exact recorded primary mapping", async () => {
  const f = await prepared(); await assignPrimary(f);
  const result = await assignPrimary({ ...f, rollback: true, confirmation: `ROLLBACK ONLY ${TARGET.alias}` });
  assert.equal(result.status, "rolled_back");
  assert.equal(f.state.posts.length, 2);
  assert.deepEqual(f.state.posts[1], { path: `/v2/deployments/${TARGET.priorDeploymentId}/aliases`, body: { alias: TARGET.alias, redirect: null } });
  assert.equal(f.state.aliases[2].deploymentId, "dpl_DifferentSibling");
});
for (const [name, mutate] of [
  ["wrong team", f => { f.state.project.accountId = "team_other"; }],
  ["wrong project", f => { f.state.project.id = "prj_other"; }],
  ["Git still connected", f => { f.state.project.link = { repo: "Release-forms" }; }],
  ["incomplete pagination", f => { f.state.paginationNext = 123; }],
  ["new sibling", f => { f.state.aliases.push(row("unexpected.vercel.app", candidate)); }],
  ["changed sibling", f => { f.state.aliases[2].deploymentId = candidate; f.state.aliases[2].deployment.id = candidate; }],
  ["sibling redirect changed", f => { f.state.aliases[2].redirect = "example.com"; }],
  ["sibling access changed", f => { f.state.aliases[2].protectionBypass = { fakeFixture: true }; }],
  ["project protection changed", f => { f.state.project.ssoProtection = null; }],
  ["project bypass registry changed", f => { f.state.project.protectionBypass = { fixture: { scope: "automation-bypass" } }; }],
  ["duplicate alias", f => { f.state.aliases.push(clone(f.state.aliases[0])); }],
  ["candidate source mismatch", f => { f.state.candidate.meta.githubCommitSha = "c".repeat(40); }],
  ["candidate belongs to another project", f => { f.state.candidate.projectId = "prj_other"; }],
  ["candidate is preview", f => { f.state.candidate.target = "preview"; }],
  ["candidate was not prebuilt", f => { f.state.candidate.prebuilt = false; }],
  ["weakened canary", f => { f.canary.exact_headers = false; }],
  ["wrong canary artifact", f => { f.canary.provider_inventory_sha256 = "d".repeat(64); }],
  ["wrong alias intent", f => { f.intent.alias = "release-forms-gemandi.vercel.app"; }],
  ["wrong rollback pin", f => { f.intent.rollback_deployment_id = "dpl_Unapproved"; }],
  ["missing explicit confirmation", f => { f.confirmation = "yes"; }],
]) {
  test(`rejects ${name} before any alias write`, async () => {
    const f = await prepared(); mutate(f);
    await assert.rejects(assignPrimary(f)); assert.equal(f.state.posts.length, 0);
  });
}
test("cannot overwrite missing durable attempt evidence or retry an uncertain write", async () => {
  const f = await prepared();
  await assert.rejects(assignPrimary({ ...f, recordAttempt: () => { throw Error("immutable attempt already exists"); } }));
  assert.equal(f.state.posts.length, 0);
  f.state.failPost = true;
  await assert.rejects(assignPrimary(f));
  assert.equal(f.state.posts.length, 1);
  assert.equal((await reconcile(f.api, f.intent)).status, "prior_mapping_unchanged");
});
test("accepted write with lost response is reconciled but never retried or declared success", async () => {
  const f = await prepared(); f.state.acceptedThenTimeout = true;
  await assert.rejects(assignPrimary(f), /response was uncertain/);
  assert.equal(f.state.posts.length, 1);
  assert.equal((await reconcile(f.api, f.intent)).status, "candidate_mapped");
  await assert.rejects(assignPrimary(f), /Alias drift/);
  assert.equal(f.state.posts.length, 1);
});
test("rollback refuses a later primary change or sibling drift", async () => {
  const f = await prepared(); await assignPrimary(f);
  f.state.aliases[2].redirect = "example.com";
  await assert.rejects(assignPrimary({ ...f, rollback: true, confirmation: `ROLLBACK ONLY ${TARGET.alias}` }));
  assert.equal(f.state.posts.length, 1);
});
test("post-write sibling race fails closed without repairing another alias", async () => {
  const f = await prepared(), original = f.api;
  const api = async (path, body) => { const response = await original(path, body); if (body) f.state.aliases[2].redirect = "example.com"; return response; };
  await assert.rejects(assignPrimary({ ...f, api }), /Alias drift/);
  assert.equal(f.state.posts.length, 1);
});
test("API always pins team/origin, uses a single exact alias request, and refuses credential redirects", async () => {
  const calls = [];
  const api = apiClient("fixture-token-not-real", async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ alias: TARGET.alias, uid: "fixture" }), { status: 200 });
  });
  await api(`/v2/deployments/${candidate}/aliases`, { alias: TARGET.alias, redirect: null });
  assert.equal(calls[0].url.origin, "https://api.vercel.com");
  assert.equal(calls[0].url.searchParams.get("teamId"), TARGET.orgId);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.method, "POST");
});
