import assert from "node:assert/strict";
import test from "node:test";
import { classifyPromotion, readPromotionSnapshot, reconcilePromotion } from "./reconcile-vercel-promotion.mjs";

const deploymentId = "dpl_new";
const rollbackDeploymentId = "dpl_old";
const rollbackAliases = [{ alias: "release-forms.vercel.app", deployment_id: rollbackDeploymentId }];
const request = (jobStatus) => ({ type: "promote", toDeploymentId: deploymentId, jobStatus });

test("promotion reconciliation accepts only provider-confirmed exact alias ownership", () => {
  const productionAliases = [{ alias: "release-forms.vercel.app", deploymentId }];
  assert.equal(classifyPromotion({ request: request("succeeded"), productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], inventoryComplete: true, deploymentId, rollbackAliases }), "promoted");
  assert.equal(classifyPromotion({ request: null, lastAliasRequestExpired: true, productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], inventoryComplete: true, deploymentId, rollbackAliases }), "promoted");
  assert.equal(classifyPromotion({ request: null, productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], inventoryComplete: true, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: null, productionAliases, aliases: [], inventoryComplete: true, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: null, productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "pending" }], inventoryComplete: true, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: null, productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], inventoryComplete: false, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: request("succeeded"), productionAliases, aliases: [], inventoryComplete: true, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: request("pending"), productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], inventoryComplete: true, deploymentId, rollbackAliases }), "pending");
  assert.equal(classifyPromotion({ request: request("succeeded"), productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "extra.example", id: "alias_2", status: "completed" }], inventoryComplete: true, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: request("succeeded"), productionAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], inventoryComplete: false, deploymentId, rollbackAliases }), "promotion_uncertain");
});

test("promotion reconciliation distinguishes a definite no-op from ambiguity", () => {
  const rolledBackAliases = [{ alias: "release-forms.vercel.app", deploymentId: rollbackDeploymentId }];
  assert.equal(classifyPromotion({ request: request("failed"), productionAliases: rolledBackAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "failed" }], inventoryComplete: true, deploymentId, rollbackAliases }), "not_promoted");
  assert.equal(classifyPromotion({ request: request("failed"), productionAliases: rolledBackAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "unknown" }], inventoryComplete: true, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: request("failed"), productionAliases: rolledBackAliases, aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], inventoryComplete: true, deploymentId, rollbackAliases }), "promotion_uncertain");
  assert.equal(classifyPromotion({ request: request("in-progress"), productionAliases: rolledBackAliases, aliases: [], inventoryComplete: true, deploymentId, rollbackAliases }), "pending");
});

const intent = {
  org_id: "team_test",
  project_id: "prj_test",
  project_name: "release-forms",
  expected_production_alias: "release-forms.vercel.app",
  deployment_id: deploymentId,
  rollback_deployment_id: rollbackDeploymentId,
  rollback_inventory: {
    org_id: "team_test",
    inventory_complete: true,
    project_id: "prj_test",
    project_name: "release-forms",
    expected_production_alias: "release-forms.vercel.app",
    deployment_id: rollbackDeploymentId,
    aliases: [
      { alias: "release-forms.vercel.app", deployment_id: rollbackDeploymentId },
      { alias: "release.example", deployment_id: rollbackDeploymentId },
    ],
  },
};

function fixtureFetch(options = {}) {
  const { promotePayload, domainsNext = null, domainDeploymentId = deploymentId, accountId = "team_test" } = options;
  const urls = [];
  const projectPayload = { id: "prj_test", name: "release-forms", accountId, link: null };
  if (options.omitLastAliasRequest !== true) {
    projectPayload.lastAliasRequest = Object.prototype.hasOwnProperty.call(options, "lastAliasRequest")
      ? options.lastAliasRequest
      : request("succeeded");
  }
  const domainsPayload = Object.prototype.hasOwnProperty.call(options, "domainsPayload")
    ? options.domainsPayload
    : { domains: [{ name: "release.example" }], pagination: { next: domainsNext } };
  const responses = new Map([
    ["https://api.vercel.com/v9/projects/prj_test?teamId=team_test", projectPayload],
    ["https://api.vercel.com/v9/projects/prj_test/domains?limit=100&teamId=team_test", domainsPayload],
    ["https://api.vercel.com/v13/deployments/release-forms.vercel.app?teamId=team_test", { id: deploymentId, name: "release-forms", target: "production", readyState: "READY" }],
    ["https://api.vercel.com/v13/deployments/release.example?teamId=team_test", { id: domainDeploymentId, name: "release-forms", target: "production", readyState: "READY" }],
    ["https://api.vercel.com/v1/projects/prj_test/promote/aliases?limit=100&teamId=team_test", promotePayload || { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }], pagination: { next: null } }],
  ]);
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      const payload = responses.get(url);
      assert.ok(payload, `Unexpected provider request: ${url}`);
      return { ok: true, status: 200, json: async () => payload };
    },
  };
}

test("reconciliation uses documented v1 status and resolves every alias", async () => {
  const fixture = fixtureFetch();
  const snapshot = await readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: fixture.fetch });
  assert.equal(snapshot.promotionState, "promoted");
  assert.equal(snapshot.provider.inventory_complete, true);
  assert.ok(fixture.urls.includes("https://api.vercel.com/v1/projects/prj_test/promote/aliases?limit=100&teamId=team_test"));
});

test("completed exact provider state remains authoritative after Vercel expires lastAliasRequest", async () => {
  const snapshot = await readPromotionSnapshot({
    intent,
    token: "token",
    teamId: "team_test",
    fetchImpl: fixtureFetch({ lastAliasRequest: null }).fetch,
  });
  assert.equal(snapshot.promotionState, "promoted");
  assert.equal(snapshot.provider.job_status, null);
  assert.equal(snapshot.provider.inventory_complete, true);
  assert.equal(snapshot.provider.last_alias_request_expired, true);
});

test("expired-request success requires an explicit null provider field", async () => {
  for (const projectVariant of [
    { omitLastAliasRequest: true },
    { lastAliasRequest: undefined },
    { lastAliasRequest: false },
    { lastAliasRequest: 0 },
    { lastAliasRequest: "" },
    { lastAliasRequest: [] },
    { lastAliasRequest: {} },
  ]) {
    const snapshot = await readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: fixtureFetch(projectVariant).fetch });
    assert.equal(snapshot.promotionState, "promotion_uncertain");
    assert.equal(snapshot.provider.last_alias_request_expired, false);
  }
});

test("reconciliation fails closed on malformed schema, pagination, or alias drift", async () => {
  const missingId = fixtureFetch({ promotePayload: { aliases: [{ alias: "release-forms.vercel.app", status: "completed" }], pagination: { next: null } } });
  assert.equal((await readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: missingId.fetch })).promotionState, "promotion_uncertain");
  const paginated = fixtureFetch({ domainsNext: 123 });
  assert.equal((await readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: paginated.fetch })).promotionState, "promotion_uncertain");
  const mixed = fixtureFetch({ domainDeploymentId: rollbackDeploymentId });
  assert.equal((await readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: mixed.fetch })).promotionState, "promotion_uncertain");
  for (const domainsPayload of [
    {},
    { domains: "invalid", pagination: { next: null } },
    { domains: [{ name: "" }], pagination: { next: null } },
    { domains: [{ name: "release.example" }, { name: "release.example" }], pagination: { next: null } },
    { domains: [{ name: "release.example" }], pagination: {} },
    { domains: [{ name: "release.example" }], pagination: "invalid" },
  ]) {
    const malformed = fixtureFetch({ domainsPayload, lastAliasRequest: null });
    assert.equal((await readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: malformed.fetch })).promotionState, "promotion_uncertain");
  }
  for (const promotePayload of [
    { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }] },
    { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }], pagination: {} },
    { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }], pagination: "invalid" },
    { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }], pagination: { next: 1 } },
  ]) {
    const malformed = fixtureFetch({ promotePayload, lastAliasRequest: null });
    assert.equal((await readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: malformed.fetch })).promotionState, "promotion_uncertain");
  }
  const oneAliasIntent = {
    ...intent,
    rollback_inventory: { ...intent.rollback_inventory, aliases: [{ alias: "release-forms.vercel.app", deployment_id: rollbackDeploymentId }] },
  };
  const validOneAlias = fixtureFetch({
    domainsPayload: { domains: [], pagination: { next: null } },
    promotePayload: { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], pagination: { next: null } },
    lastAliasRequest: null,
  });
  assert.equal((await readPromotionSnapshot({ intent: oneAliasIntent, token: "token", teamId: "team_test", fetchImpl: validOneAlias.fetch })).promotionState, "promoted");
  const missingDomainsOneAlias = fixtureFetch({
    domainsPayload: { pagination: { next: null } },
    promotePayload: { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }], pagination: { next: null } },
    lastAliasRequest: null,
  });
  assert.equal((await readPromotionSnapshot({ intent: oneAliasIntent, token: "token", teamId: "team_test", fetchImpl: missingDomainsOneAlias.fetch })).promotionState, "promotion_uncertain");
  await assert.rejects(() => readPromotionSnapshot({ intent, token: "token", teamId: "team_other", fetchImpl: fixtureFetch().fetch }), /rollback alias inventory/);
  await assert.rejects(() => readPromotionSnapshot({ intent, token: "token", teamId: "team_test", fetchImpl: fixtureFetch({ accountId: "team_other" }).fetch }), /project identity changed/);
});

function sequenceFetch(states) {
  let stateIndex = -1;
  let current = states[0];
  let projectCalls = 0;
  return {
    get projectCalls() { return projectCalls; },
    fetch: async (url) => {
      if (url.includes("/v9/projects/prj_test?")) {
        stateIndex += 1;
        projectCalls += 1;
        current = states[Math.min(stateIndex, states.length - 1)];
        return { ok: true, status: 200, json: async () => ({ id: "prj_test", name: "release-forms", accountId: "team_test", link: null, lastAliasRequest: current.request }) };
      }
      if (url.includes("/v9/projects/prj_test/domains?")) return { ok: true, status: 200, json: async () => ({ domains: [{ name: "release.example" }], pagination: { next: null } }) };
      if (url.includes("/v13/deployments/")) return { ok: true, status: 200, json: async () => ({ id: current.deploymentId, name: "release-forms", target: "production", readyState: "READY" }) };
      if (url.includes("/v1/projects/prj_test/promote/aliases?")) return { ok: true, status: 200, json: async () => current.promotePayload };
      assert.fail(`Unexpected provider request: ${url}`);
    },
  };
}

test("bounded reconciliation polls uncertain and pending state until exact promotion", async () => {
  const fixture = sequenceFetch([
    { request: null, deploymentId: rollbackDeploymentId, promotePayload: { aliases: [], pagination: { next: null } } },
    { request: request("pending"), deploymentId: rollbackDeploymentId, promotePayload: { aliases: [], pagination: { next: null } } },
    { request: request("succeeded"), deploymentId, promotePayload: { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }], pagination: { next: null } } },
  ]);
  let clock = 0;
  const result = await reconcilePromotion({ intent, token: "token", teamId: "team_test", fetchImpl: fixture.fetch, now: () => clock, sleepImpl: async (ms) => { clock += ms; }, timeoutMs: 10, pollMs: 1 });
  assert.equal(result.promotionState, "promoted");
  assert.equal(fixture.projectCalls, 4);
});

test("bounded reconciliation rejects a composite snapshot changed during alias reads", async () => {
  let projectCalls = 0;
  let deploymentCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/v9/projects/prj_test?")) {
      projectCalls += 1;
      return { ok: true, status: 200, json: async () => ({ id: "prj_test", name: "release-forms", accountId: "team_test", link: null, lastAliasRequest: null }) };
    }
    if (url.includes("/v9/projects/prj_test/domains?")) return { ok: true, status: 200, json: async () => ({ domains: [{ name: "release.example" }], pagination: { next: null } }) };
    if (url.includes("/v1/projects/prj_test/promote/aliases?")) return { ok: true, status: 200, json: async () => ({ aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }], pagination: { next: null } }) };
    if (url.includes("/v13/deployments/")) {
      deploymentCalls += 1;
      const id = deploymentCalls === 2 ? rollbackDeploymentId : deploymentId;
      return { ok: true, status: 200, json: async () => ({ id, name: "release-forms", target: "production", readyState: "READY" }) };
    }
    assert.fail(`Unexpected provider request: ${url}`);
  };
  let clock = 0;
  const result = await reconcilePromotion({ intent, token: "token", teamId: "team_test", fetchImpl, now: () => clock, sleepImpl: async (ms) => { clock += ms; }, timeoutMs: 10, pollMs: 1 });
  assert.equal(result.promotionState, "promoted");
  assert.equal(projectCalls, 3);
});

test("bounded reconciliation does not accept one promoted snapshot followed by rollback drift", async () => {
  const fixture = sequenceFetch([
    { request: null, deploymentId, promotePayload: { aliases: [{ alias: "release-forms.vercel.app", id: "alias_1", status: "completed" }, { alias: "release.example", id: "alias_2", status: "completed" }], pagination: { next: null } } },
    { request: null, deploymentId: rollbackDeploymentId, promotePayload: { aliases: [], pagination: { next: null } } },
  ]);
  let clock = 0;
  const result = await reconcilePromotion({ intent, token: "token", teamId: "team_test", fetchImpl: fixture.fetch, now: () => clock, sleepImpl: async (ms) => { clock += ms; }, timeoutMs: 2, pollMs: 1 });
  assert.equal(result.promotionState, "promotion_uncertain");
  assert.equal(fixture.projectCalls, 3);
});

test("bounded reconciliation preserves latest evidence and fails uncertain at deadline", async () => {
  const fixture = sequenceFetch([{ request: null, deploymentId: rollbackDeploymentId, promotePayload: { aliases: [], pagination: { next: null } } }]);
  let clock = 0;
  const result = await reconcilePromotion({ intent, token: "token", teamId: "team_test", fetchImpl: fixture.fetch, now: () => clock, sleepImpl: async (ms) => { clock += ms; }, timeoutMs: 2, pollMs: 1 });
  assert.equal(result.promotionState, "promotion_uncertain");
  assert.equal(result.lastEvidence.production_aliases.length, 2);
  assert.equal(fixture.projectCalls, 3);
});
