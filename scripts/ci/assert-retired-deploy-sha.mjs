#!/usr/bin/env node
// Read-only current-main admission without git fetch, persisted credentials,
// installed dependencies, configurable API origins, or credential subprocesses.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORY = "aleink/Release-forms";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export async function assertRetiredCurrentMain({ expected, head, token, fetchImpl = fetch }) {
  assert(/^[a-f0-9]{40}$/.test(expected ?? ""), "A full lowercase release SHA is required");
  assert(head === expected, "The checkout is not the requested exact release SHA");
  assert(typeof token === "string" && token.length > 0, "Step-scoped read-only GitHub authentication is required");
  const get = async path => {
    let response;
    try {
      response = await fetchImpl(new URL(path, "https://api.github.com"), {
        method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28" }, redirect: "error", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error("Read-only GitHub admission request failed"); }
    assert(response.ok, `Read-only GitHub admission returned HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    assert(bytes.byteLength <= 2 * 1024 * 1024, "GitHub admission response exceeds bound");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error("GitHub admission returned malformed JSON"); }
  };
  const branch = await get(`/repos/${REPOSITORY}/branches/main`);
  assert(branch.name === "main" && branch.protected === true && branch.commit?.sha === expected,
    "Requested source is no longer the current protected main SHA");
  const runs = await get(`/repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${expected}&event=push&branch=main&per_page=100`);
  assert(Array.isArray(runs.workflow_runs) && runs.workflow_runs.length > 0 && runs.workflow_runs.length <= 100 &&
    (runs.total_count === undefined || (Number.isSafeInteger(runs.total_count) && runs.total_count <= 100)), "Incomplete or unbounded exact-source CI history");
  assert(runs.workflow_runs.every(run => Number.isSafeInteger(run.id) && Number.isSafeInteger(run.run_number)), "Malformed exact-source CI identity");
  const latest = [...runs.workflow_runs].sort((a, b) => a.run_number - b.run_number || a.id - b.id).at(-1);
  assert(latest.head_sha === expected && latest.head_branch === "main" && latest.event === "push" &&
    latest.path === ".github/workflows/ci.yml" && latest.head_repository?.full_name === REPOSITORY &&
    latest.repository?.full_name === REPOSITORY && latest.status === "completed" && latest.conclusion === "success",
  "Latest exact-SHA main push CI is not successful for the trusted repository");
  return { sha: expected, ci_run_id: latest.id };
}

async function main() {
  const expected = process.argv[2]?.trim().toLowerCase();
  // Even local git receives no credential environment. It never contacts a remote.
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", env: gitEnv }).trim().toLowerCase();
  await assertRetiredCurrentMain({ expected, head, token: process.env.GH_TOKEN });
  console.log("Exact checkout, current protected main, and latest matching CI verified without persisted Git credentials.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
