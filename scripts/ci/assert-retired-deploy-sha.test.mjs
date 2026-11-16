import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertRetiredCurrentMain } from "./assert-retired-deploy-sha.mjs";

const expected = "a".repeat(40), repository = "aleink/Release-forms";
const goodRun = { id: 100, run_number: 10, head_sha: expected, head_branch: "main", event: "push",
  path: ".github/workflows/ci.yml", head_repository: { full_name: repository }, repository: { full_name: repository },
  status: "completed", conclusion: "success" };
function fixture(overrides = {}) {
  const state = { branch: { name: "main", protected: true, commit: { sha: expected } },
    runs: { total_count: 1, workflow_runs: [structuredClone(goodRun)] }, requests: [], ...overrides };
  const fetchImpl = async (url, options) => {
    state.requests.push({ url, options });
    return new Response(JSON.stringify(url.pathname.endsWith("/branches/main") ? state.branch : state.runs), { status: 200 });
  };
  return { state, input: { expected, head: expected, token: "fixture-only-token", fetchImpl } };
}
test("private repository admission uses only two authenticated GETs with no credential redirects", async () => {
  const f = fixture();
  assert.deepEqual(await assertRetiredCurrentMain(f.input), { sha: expected, ci_run_id: 100 });
  assert.equal(f.state.requests.length, 2);
  for (const { url, options } of f.state.requests) {
    assert.equal(url.origin, "https://api.github.com"); assert.ok(url.pathname.startsWith(`/repos/${repository}/`));
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer fixture-only-token");
    assert.equal(options.body, undefined);
  }
  assert.equal(f.state.requests[1].url.searchParams.get("head_sha"), expected);
  assert.equal(f.state.requests[1].url.searchParams.has("status"), false);
});
for (const [name, mutate] of [
  ["different checkout", f => { f.input.head = "b".repeat(40); }],
  ["invalid source", f => { f.input.expected = "main"; }],
  ["missing ephemeral token", f => { f.input.token = ""; }],
  ["main changed", f => { f.state.branch.commit.sha = "b".repeat(40); }],
  ["branch protection removed", f => { f.state.branch.protected = false; }],
  ["branch name changed", f => { f.state.branch.name = "other"; }],
  ["missing CI", f => { f.state.runs.workflow_runs = []; }],
  ["incomplete CI history", f => { f.state.runs.total_count = 101; }],
  ["wrong CI source", f => { f.state.runs.workflow_runs[0].head_sha = "b".repeat(40); }],
  ["wrong CI event", f => { f.state.runs.workflow_runs[0].event = "pull_request"; }],
  ["wrong CI branch", f => { f.state.runs.workflow_runs[0].head_branch = "other"; }],
  ["wrong CI workflow", f => { f.state.runs.workflow_runs[0].path = ".github/workflows/other.yml"; }],
  ["fork CI", f => { f.state.runs.workflow_runs[0].head_repository.full_name = "outside/fork"; }],
  ["wrong repository CI", f => { f.state.runs.workflow_runs[0].repository.full_name = "outside/fork"; }],
  ["missing run identity", f => { delete f.state.runs.workflow_runs[0].id; }],
  ["pending CI", f => { f.state.runs.workflow_runs[0].status = "in_progress"; }],
  ["failed CI", f => { f.state.runs.workflow_runs[0].conclusion = "failure"; }],
  ["newer failure after old success", f => { f.state.runs.workflow_runs.push({ ...goodRun, id: 101, run_number: 11, conclusion: "failure" }); }],
  ["newer pending after old success", f => { f.state.runs.workflow_runs.push({ ...goodRun, id: 101, run_number: 11, status: "queued" }); }],
]) test(`read-only admission rejects ${name}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(assertRetiredCurrentMain(f.input));
});
test("provider failure and malformed JSON are fatal without credential-bearing error output", async () => {
  for (const fetchImpl of [
    async () => { throw Error("fixture-only-token must not leak"); },
    async () => new Response("no", { status: 403 }),
    async () => new Response("not-json", { status: 200 }),
  ]) await assert.rejects(assertRetiredCurrentMain({ ...fixture().input, fetchImpl }), error => !error.message.includes("fixture-only-token"));
});
test("source has no Git fetch/config/network subprocess, installed dependency, or token logging", () => {
  const source = readFileSync(new URL("assert-retired-deploy-sha.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /execFileSync\("git", \["(?:fetch|config|push|clone)"/);
  assert.match(source, /execFileSync\("git", \["rev-parse", "HEAD"\], \{ encoding: "utf8", env: gitEnv \}\)/);
  assert.match(source, /!\/TOKEN\|SECRET\|PASSWORD\|CREDENTIAL\/i.test\(key\)/);
  assert.doesNotMatch(source, /from ["'](?!node:)|writeFile|appendFile|console\.(?:log|error)\([^\n]*(?:token|GH_TOKEN)/i);
});
