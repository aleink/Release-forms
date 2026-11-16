import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/deploy-retired-primary-alias.yml", import.meta.url), "utf8");
const step = name => {
  const value = workflow.split(/\n(?=      - )/).find(part => part.startsWith(`      - name: ${name}\n`));
  assert.ok(value, `Missing governed step: ${name}`); return value;
};
test("single-alias flow defaults off, excludes old publisher, and serializes the same production lane", () => {
  assert.match(workflow, /ENABLE_RETIRED_PRIMARY_ALIAS_DEPLOYMENT == 'true' && vars.ENABLE_RELEASE_FORMS_PRODUCTION_DEPLOYMENT != 'true'/);
  assert.match(workflow, /group: production-vercel-\$\{\{ github.repository }}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal((workflow.match(/environment: Production/g) ?? []).length, 2);
  assert.match(workflow, /test "\$GITHUB_REPOSITORY" = "aleink\/Release-forms"/);
  assert.doesNotMatch(workflow, /vercel[^\n]*(?: promote | rollback | alias | curl |--force|--token)|protection-bypass=/);
});
test("stage and publish both run identical trusted current-main admission before selected code", () => {
  const jobs = workflow.split("  publish:\n");
  for (const job of jobs) {
    assert.ok(job.indexOf("Admit trusted current-main source before checkout") < job.indexOf("actions/checkout@"));
    assert.match(job, /GITHUB_REF_PROTECTED/); assert.match(job, /sort_by\(.run_number, .id\) \| last/);
  }
  const blocks = workflow.split(/\n(?=      - )/).filter(x => x.startsWith("      - name: Admit trusted current-main source before checkout\n"));
  assert.equal(blocks.length, 2); assert.equal(blocks[0], blocks[1]);
});
test("stage builds without provider credentials and uploads no pulled configuration", () => {
  for (const name of ["Install and retest without provider credentials", "Install and exercise pinned CLI without provider credentials", "Build once and seal exact inactive production bytes"])
    assert.doesNotMatch(step(name), /secrets\.|VERCEL_TOKEN|RETIRED_ALIAS_CANARY_ACCESS|GH_TOKEN|github.token/);
  assert.match(step("Stage production artifact without assigning aliases"), /deploy --prebuilt --prod --skip-domain/);
  assert.match(step("Bind every provider file and immutable single-alias intent"), /capture-vercel-deployment-files\.mjs/);
  assert.match(step("Retain immutable staged artifact for this exact run"), /path: stage-artifact\n/);
  assert.doesNotMatch(workflow, /cp[^\n]*\.vercel\/(?:project|\.env)|path: \.vercel/);
});
test("project-token lane never uses scope, CLI pull/inspect, env API or project-ID overrides", () => {
  assert.doesNotMatch(workflow, /--scope|--team|^\s+VERCEL_ORG_ID:|^\s+VERCEL_PROJECT_ID:|\bvercel@59\.10\.0 (?:pull|inspect)/m);
  assert.match(step("Prepare only the pinned project settings with an empty build environment"), /retired-project-token\.mjs prepare/);
  const install = step("Install and exercise pinned CLI without provider credentials");
  assert.match(install, /--ignore-scripts --no-audit --no-fund vercel@59\.10\.0/);
  assert.match(install, /test-retired-project-cli\.mjs/);
  assert.match(step("Stage production artifact without assigning aliases"), /retired-project-token\.mjs check/);
  assert.match(step("Stage production artifact without assigning aliases"), /retired-project-token\.mjs identify/);
  assert.doesNotMatch(step("Stage production artifact without assigning aliases"), /npx|npm install|--api/);
  assert.equal((workflow.match(/verify-vercel-output\.mjs[^\n]+--retired-project-token/g) ?? []).length, 2);
  assert.equal((workflow.match(/capture-vercel-deployment-files\.mjs[^\n]+--retired-project-token/g) ?? []).length, 2);
});
test("publish is source-bound, artifact-ID-bound and performs no rebuild", () => {
  const publish = workflow.split("  publish:\n")[1];
  assert.match(step("Download only this run's immutable staged artifact"), /artifact-ids: \$\{\{ needs.stage.outputs.artifact_id }}/);
  assert.doesNotMatch(publish, /npm (?:ci|install|run build)|vercel@59.10.0 (?:build|deploy)/);
  assert.match(step("Reverify staged build bytes and source"), /artifactDigest|retired-alias-canary\.mjs digest/);
  assert.match(step("Reverify staged build bytes and source"), /i.run_id!==process.env.GITHUB_RUN_ID/);
  assert.match(step("Re-enumerate exact provider files and preserve all prior mappings"), /cmp --silent/);
});
test("canary precedes immutable write arm and alias-only write; immutable arm prevents uncertain retry", () => {
  const names = ["Verify exact staged bytes and headers without automatic access changes", "Recheck current protected main immediately before arming",
    "Arm one alias write with immutable evidence", "Assign only release-forms.vercel.app once"];
  const indexes = names.map(name => workflow.indexOf(`      - name: ${name}\n`));
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
  const arm = step(names[2]);
  assert.match(arm, /name: retired-primary-alias-write-armed-\$\{\{ github.run_id }}/);
  assert.match(arm, /overwrite: false/);
  assert.doesNotMatch(arm, /name:.*github.run_attempt/);
  assert.match(step("Recheck current protected main immediately before the alias write"), /assert-retired-deploy-sha\.mjs/);
  assert.ok(workflow.indexOf("Recheck current protected main immediately before the alias write") > indexes[2]);
  assert.ok(workflow.indexOf("Recheck current protected main immediately before the alias write") < indexes[3]);
  assert.match(step(names[3]), /continue-on-error: true/);
});
test("both checkouts discard Git credentials and GitHub auth is confined to read-only checks", () => {
  const checkouts = workflow.split(/\n(?=      - )/).filter(part => part.includes("- uses: actions/checkout@"));
  assert.equal(checkouts.length, 2);
  for (const checkout of checkouts) assert.match(checkout, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /assert-deploy-sha\.mjs|git fetch|git config/);
  const steps = workflow.split(/\n(?=      - )/);
  const authenticated = steps.filter(part => /GH_TOKEN:/.test(part));
  assert.equal(authenticated.length, 6); // Two pre-checkout admissions + four isolated current-main checks.
  for (const checked of authenticated) {
    assert.match(checked, /GH_TOKEN: \$\{\{ github.token }}/);
    assert.doesNotMatch(checked, /npm |npx |VERCEL_TOKEN|secrets\.|retired-alias-canary\.mjs|retired-single-alias\.mjs/);
  }
  for (const name of ["Install and retest without provider credentials", "Build once and seal exact inactive production bytes",
    "Verify exact staged bytes and headers without automatic access changes", "Verify the public target without any bypass",
    "Assign only release-forms.vercel.app once"]) assert.doesNotMatch(step(name), /GH_TOKEN|github.token/);
});
test("only exact staged canary gets optional access, public canary stays credential-free", () => {
  assert.match(step("Verify exact staged bytes and headers without automatic access changes"), /secrets.RETIRED_ALIAS_CANARY_ACCESS/);
  assert.doesNotMatch(step("Verify the public target without any bypass"), /secrets\.|VERCEL_TOKEN|RETIRED_ALIAS_CANARY_ACCESS/);
  assert.match(step("Always reconcile the target and every sibling after arming"), /if: always\(\) && steps.arm.outcome == 'success'/);
  assert.match(step("Require confirmed mutation and public verification"), /test -f publish-evidence\/public-canary-evidence.json/);
});
