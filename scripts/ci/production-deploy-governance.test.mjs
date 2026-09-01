import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(".github/workflows/deploy-vercel-production.yml"), "utf8");
const liveVerifier = readFileSync(resolve("scripts/ci/verify-live-vercel-canary.mjs"), "utf8");
const deploymentInventory = readFileSync(resolve("scripts/ci/capture-vercel-deployment-files.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

test("retired release publisher remains manual, default-off, and exact-project bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /ENABLE_RELEASE_FORMS_PRODUCTION_DEPLOYMENT == 'true'/);
  assert.match(workflow, /PROMOTE RETIRED RELEASE_FORMS/);
  assert.match(workflow, /EXPECTED_VERCEL_ORG_ID: team_dYh8hnyuxB6dbWOjq34jIHNg/);
  assert.match(workflow, /EXPECTED_VERCEL_PROJECT_ID: prj_AgFYzaxmaGGuLPQnxkeSfzLawwMX/);
  assert.match(workflow, /EXPECTED_VERCEL_PROJECT_NAME: release-forms/);
  assert.match(workflow, /EXPECTED_PRODUCTION_ALIAS: release-forms[.]vercel[.]app/);
  assert.match(workflow, /if\(p[.]link!=null\)throw new Error\("Git integration must be disconnected/);
  assert.match(workflow, /p[.]accountId!==process[.]env[.]EXPECTED_VERCEL_ORG_ID/);
  assert.match(workflow, /p[.]orgId!==process[.]env[.]EXPECTED_VERCEL_ORG_ID/);
  assert.match(workflow, /org_id:e[.]EXPECTED_VERCEL_ORG_ID/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("unprivileged source work cannot access provider or attestation credentials", () => {
  const topPermissions = workflow.slice(workflow.indexOf("permissions:"), workflow.indexOf("concurrency:"));
  assert.match(topPermissions, /contents: read/);
  assert.doesNotMatch(topPermissions, /id-token: write|attestations: write/);
  const installStep = workflow.slice(workflow.indexOf("Install and retest"), workflow.indexOf("Enforce the exact"));
  assert.doesNotMatch(installStep, /VERCEL_TOKEN|VERCEL_ORG_ID|VERCEL_PROJECT_ID|id-token/);
  const attestJob = workflow.slice(workflow.indexOf("  attest-release:"));
  assert.match(attestJob, /id-token: write/);
  assert.match(attestJob, /attestations: write/);
  assert.doesNotMatch(attestJob, /npm |node scripts|actions\/checkout/);
});

test("one exact static artifact is canaried and bound before any promotion", () => {
  const seal = workflow.indexOf('cp -a -- dist "$RUNNER_TEMP/reviewed-dist"');
  const build = workflow.indexOf("vercel@59.10.0 build --prod");
  const verify = workflow.indexOf('verify-vercel-output.mjs .vercel/output "$RUNNER_TEMP/reviewed-dist"');
  const deploy = workflow.indexOf("deploy --prebuilt --prod --skip-domain");
  const inspect = workflow.indexOf("vercel@59.10.0 inspect");
  const inventory = workflow.indexOf("capture-vercel-deployment-files.mjs");
  const exactBytes = workflow.indexOf("verify-live-vercel-canary.mjs");
  const intent = workflow.indexOf("Persist full promotion intent");
  const promote = workflow.indexOf("vercel@59.10.0 promote");
  assert.ok(seal >= 0 && build > seal && verify > build && deploy > verify && inspect > deploy && inventory > inspect && exactBytes > inventory && intent > exactBytes && promote > intent);
  assert.match(liveVerifier, /headers[.]length !== 10/);
  assert.match(liveVerifier, /missing or weakened/);
  assert.match(deploymentInventory, /\/v6\/deployments\/\$\{encodeURIComponent\(deploymentId\)\}\/files/);
  assert.match(deploymentInventory, /Vercel complete deployment file tree differs/);
  assert.match(workflow, /deployment-file-inventory[.]json/);
  assert.match(workflow, /done < "\$RUNNER_TEMP\/provider-static-files"/);
  assert.doesNotMatch(workflow.slice(inventory, exactBytes), /reviewed-dist" && find|find [.]+ -type f/);
  assert.match(packageJson.scripts["test:security"], /capture-vercel-deployment-files[.]test[.]mjs/);
  assert.match(workflow, /live-static/);
});

test("promotion is preceded by exact rollback and main rechecks and always reconciled", () => {
  const firstCapture = workflow.indexOf("capture-vercel-rollback.mjs release-evidence/rollback-inventory.json");
  const intentUpload = workflow.indexOf("Retain immutable pre-promotion intent");
  const recapture = workflow.indexOf("rollback-inventory-recheck.json");
  const mainRecheck = workflow.indexOf("Recheck current main immediately before promotion");
  const promote = workflow.indexOf("Promote the exact inactive canary");
  const reconcile = workflow.indexOf("Always reconcile provider promotion state");
  assert.ok(firstCapture >= 0 && intentUpload > firstCapture && recapture > intentUpload && mainRecheck > recapture && promote > mainRecheck && reconcile > promote);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /if: always\(\) && steps[.]intent[.]outcome == 'success'/);
  assert.match(workflow, /Do not retry promotion blindly/);
  assert.match(workflow, /if: always\(\)[\s\S]*vercel-deployment-evidence/);
});
