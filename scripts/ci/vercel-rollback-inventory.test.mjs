import assert from "node:assert/strict";
import test from "node:test";
import { captureRollbackInventory } from "./capture-vercel-rollback.mjs";

function fixtureFetch({ next = null, customDeploymentId = "dpl_old", link = null } = {}) {
  const urls = [];
  const responses = new Map([
    ["https://api.vercel.com/v9/projects/prj_test?teamId=team_test", { id: "prj_test", name: "release-forms", link }],
    ["https://api.vercel.com/v9/projects/prj_test/domains?limit=100&teamId=team_test", { domains: [{ name: "release.example" }], pagination: { next } }],
    ["https://api.vercel.com/v13/deployments/release-forms.vercel.app?teamId=team_test", { id: "dpl_old", name: "release-forms", target: "production", readyState: "READY" }],
    ["https://api.vercel.com/v13/deployments/release.example?teamId=team_test", { id: customDeploymentId, name: "release-forms", target: "production", readyState: "READY" }],
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

const options = {
  token: "token",
  teamId: "team_test",
  projectId: "prj_test",
  projectName: "release-forms",
  expectedProductionAlias: "release-forms.vercel.app",
};

test("rollback capture records the complete exact pre-promotion alias map", async () => {
  const fixture = fixtureFetch();
  const inventory = await captureRollbackInventory({ ...options, fetchImpl: fixture.fetch });
  assert.equal(inventory.inventory_complete, true);
  assert.equal(inventory.deployment_id, "dpl_old");
  assert.deepEqual(inventory.aliases, [
    { alias: "release-forms.vercel.app", deployment_id: "dpl_old" },
    { alias: "release.example", deployment_id: "dpl_old" },
  ]);
});

test("rollback capture rejects pagination, mixed deployments, and Git linkage", async () => {
  await assert.rejects(() => captureRollbackInventory({ ...options, fetchImpl: fixtureFetch({ next: 123 }).fetch }), /incomplete or paginated/);
  await assert.rejects(() => captureRollbackInventory({ ...options, fetchImpl: fixtureFetch({ customDeploymentId: "dpl_other" }).fetch }), /do not share one safe rollback/);
  await assert.rejects(() => captureRollbackInventory({ ...options, fetchImpl: fixtureFetch({ link: { type: "github" } }).fetch }), /dedicated non-Git project/);
});
