import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const paths = [".github/workflows/deploy-vercel-production.yml"];
const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const repository = "fixture/release-repository";
const successfulRun = {
  id: 100, run_number: 10, head_sha: sha, head_branch: "main", event: "push",
  path: ".github/workflows/ci.yml", status: "completed", conclusion: "success",
  head_repository: { full_name: repository }, repository: { full_name: repository },
};

function stepOf(workflow, name) {
  const step = workflow.split(/\n(?=      - )/).find(part => part.startsWith("      - name: " + name + "\n"));
  assert.ok(step, "Expected named release step: " + name);
  return step;
}

function scriptOf(step) {
  const marker = "        run: |\n";
  assert.ok(step.includes(marker), "Admission must remain an inline trusted shell block");
  return step.slice(step.indexOf(marker) + marker.length).split("\n")
    .filter(line => line.trim()).map(line => {
      assert.ok(line.startsWith("          "), "Unexpected shell indentation");
      return line.slice(10);
    }).join("\n");
}

// Real workflow shell and jq execute against fixture responses. No repository
// checkout, credentials, network, deployment, or provider mutation is possible.
function runGate(script, path, overrides = {}, responses = {}) {
  const directory = mkdtempSync(join(tmpdir(), "release-admission-fixture-"));
  try {
    const output = join(directory, "output");
    const ghStub = [
      "gh() {",
      '  case "$*" in',
      '    "api repos/$GITHUB_REPOSITORY/branches/main")',
      '      test "$FIXTURE_API_FAILURE" != "branch" || return 1',
      '      printf "%s" "$FIXTURE_BRANCH_JSON" ;;',
      '    "api --method GET repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs -f head_sha=$GITHUB_SHA -f event=push -f branch=main -f per_page=100")',
      '      test "$FIXTURE_API_FAILURE" != "ci" || return 1',
      '      printf "%s" "$FIXTURE_CI_JSON" ;;',
      '    *) echo "Unexpected fixture API request" >&2; return 99 ;;',
      "  esac",
      "}",
    ].join("\n");
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", ghStub + "\n" + script], {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        GITHUB_REPOSITORY: repository, GITHUB_REF: "refs/heads/main", GITHUB_REF_PROTECTED: "true",
        GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha,
        GITHUB_WORKFLOW_REF: repository + "/" + path + "@refs/heads/main",
        GITHUB_EVENT_NAME: "workflow_dispatch", RELEASE_SHA: sha, MANUAL_SHA: sha,
        UPSTREAM_SHA: sha, UPSTREAM_EVENT: "push", UPSTREAM_CONCLUSION: "success",
        UPSTREAM_BRANCH: "main", UPSTREAM_REPOSITORY: repository, UPSTREAM_PATH: ".github/workflows/ci.yml",
        GITHUB_OUTPUT: output, FIXTURE_API_FAILURE: "",
        FIXTURE_BRANCH_JSON: JSON.stringify(responses.branch ?? { name: "main", protected: true, commit: { sha } }),
        FIXTURE_CI_JSON: typeof responses.ci === "string" ? responses.ci : JSON.stringify(responses.ci ?? { workflow_runs: [successfulRun] }),
        ...overrides,
      },
    });
    assert.ifError(result.error);
    return { ...result, output: result.status === 0 && path.endsWith("/pages.yml") ? readFileSync(output, "utf8") : "" };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const path of paths) {
  const workflow = readFileSync(new URL(path, root), "utf8");
  const pages = path.endsWith("/pages.yml");
  const gateName = pages ? "Resolve release SHA" : "Admit trusted current-main source before checkout";
  const gate = stepOf(workflow, gateName);
  const script = scriptOf(gate);

  test(path + ": admission is inline, read-only and before any selected-source step", () => {
    const beforeCheckout = workflow.slice(0, workflow.indexOf("actions/checkout@"));
    assert.ok(beforeCheckout.includes(gate));
    assert.match(beforeCheckout, /actions: read/);
    assert.doesNotMatch(gate, /VERCEL_TOKEN|secrets\.|node |npm |scripts\/|curl |git /);
    assert.match(gate, /GH_TOKEN: \$\{\{ github\.token }}/);
    assert.match(gate, /GITHUB_WORKFLOW_SHA/);
    assert.doesNotMatch(gate, /-f status=success/);
    assert.doesNotMatch(script, /\$\{\{ inputs\./);
  });

  test(path + ": accepts exact protected current main with its latest successful push CI", () => {
    const result = runGate(script, path);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (pages) assert.equal(result.output, "sha=" + sha + "\n");
  });

  for (const [name, overrides] of [
    ["different selected source", { RELEASE_SHA: otherSha, MANUAL_SHA: otherSha }],
    ["non-main workflow", { GITHUB_REF: "refs/heads/unreviewed" }],
    ["tag workflow", { GITHUB_REF: "refs/tags/main" }],
    ["unprotected workflow ref", { GITHUB_REF_PROTECTED: "false" }],
    ["different workflow file", { GITHUB_WORKFLOW_REF: repository + "/.github/workflows/other.yml@refs/heads/main" }],
    ["different workflow revision", { GITHUB_WORKFLOW_SHA: otherSha }],
    ["unsupported event", { GITHUB_EVENT_NAME: "pull_request" }],
    ["invalid requested SHA", { RELEASE_SHA: "main", MANUAL_SHA: "main" }],
    ["branch provider outage", { FIXTURE_API_FAILURE: "branch" }],
    ["CI provider outage", { FIXTURE_API_FAILURE: "ci" }],
  ]) {
    test(path + ": rejects " + name, () => assert.notEqual(runGate(script, path, overrides).status, 0));
  }

  for (const [name, branch] of [
    ["superseded main", { name: "main", protected: true, commit: { sha: otherSha } }],
    ["no current branch protection", { name: "main", protected: false, commit: { sha } }],
    ["wrong branch response", { name: "other", protected: true, commit: { sha } }],
    ["incomplete branch response", {}],
  ]) {
    test(path + ": rejects " + name, () => assert.notEqual(runGate(script, path, {}, { branch }).status, 0));
  }

  for (const [name, ci] of [
    ["missing CI", { workflow_runs: [] }],
    ["malformed CI", "not-json"],
    ...[
      ["failed CI", { conclusion: "failure" }],
      ["missing CI run identity", { id: undefined }],
      ["pending CI", { status: "in_progress", conclusion: null }],
      ["PR CI", { event: "pull_request" }],
      ["other branch CI", { head_branch: "unreviewed" }],
      ["wrong source CI", { head_sha: otherSha }],
      ["fork CI", { head_repository: { full_name: "outside/fork" } }],
      ["wrong repository CI", { repository: { full_name: "outside/fork" } }],
      ["different workflow CI", { path: ".github/workflows/other.yml" }],
    ].map(([name, change]) => [name, { workflow_runs: [{ ...successfulRun, ...change }] }]),
    ["newer failed CI after an older success", { workflow_runs: [successfulRun, { ...successfulRun, id: 101, run_number: 11, conclusion: "failure" }] }],
    ["newer pending CI after an older success", { workflow_runs: [successfulRun, { ...successfulRun, id: 101, run_number: 11, status: "queued", conclusion: null }] }],
    ["newer unexpected provider result after an older success", { workflow_runs: [successfulRun, { ...successfulRun, id: 101, run_number: 11, head_repository: { full_name: "outside/fork" } }] }],
  ]) {
    test(path + ": rejects " + name, () => assert.notEqual(runGate(script, path, {}, { ci }).status, 0));
  }

  if (pages) {
    test(path + ": accepts an exact same-repository successful main push workflow_run", () => {
      const result = runGate(script, path, { GITHUB_EVENT_NAME: "workflow_run" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.output, "sha=" + sha + "\n");
    });
    for (const [name, overrides] of [
      ["PR trigger", { UPSTREAM_EVENT: "pull_request" }],
      ["failed trigger", { UPSTREAM_CONCLUSION: "failure" }],
      ["non-main trigger", { UPSTREAM_BRANCH: "unreviewed" }],
      ["fork trigger", { UPSTREAM_REPOSITORY: "outside/fork" }],
      ["different workflow trigger", { UPSTREAM_PATH: ".github/workflows/other.yml" }],
      ["superseded trigger", { UPSTREAM_SHA: otherSha }],
    ]) {
      test(path + ": rejects " + name, () => assert.notEqual(runGate(script, path, { GITHUB_EVENT_NAME: "workflow_run", ...overrides }).status, 0));
    }
  }
}
