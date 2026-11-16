import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createIntent, TARGET, digest } from "./retired-single-alias.mjs";
import { artifactDigest, temporaryShareAccess, fetchShareResource, runCanary } from "./retired-alias-canary.mjs";

const headers = Object.fromEntries(JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url))).headers[0].headers.map(({ key, value }) => [key, value]));
const now = 1800000000000;
function fixture() {
  const parent = mkdtempSync(resolve(tmpdir(), "retired-alias-canary-"));
  const reviewedRoot = resolve(parent, "reviewed"); mkdirSync(resolve(reviewedRoot, "assets"), { recursive: true });
  const files = ["assets/index-AbCdEf12.css", "assets/index-ZyXwVu98.js", "index.html"];
  for (const file of files) writeFileSync(resolve(reviewedRoot, file), file === "index.html" ? "This standalone form is not active." : "inactive");
  const inventory = { schema: 1, source: "vercel-v6-deployment-files", complete: true,
    pagination: { kind: "single_recursive_tree", pages: 1, continuation: null }, org_id: TARGET.orgId, project_id: TARGET.projectId,
    project_name: TARGET.projectName, deployment_id: "dpl_Candidate", deployment_url: "https://release-forms-fixture-gemandi.vercel.app",
    provider_files: [".vercel/output/builds.json", ".vercel/output/config.json", ".vercel/output/diagnostics/cli_traces.json", ...files.map(x => `.vercel/output/static/${x}`)],
    provider_directories: [".vercel", ".vercel/output", ".vercel/output/diagnostics", ".vercel/output/static", ".vercel/output/static/assets"], files, directories: ["assets"] };
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  const baseline = { schema: 1, org_id: TARGET.orgId, project_id: TARGET.projectId, primary_alias: TARGET.alias,
    complete: true, project_config_sha256: "a".repeat(64), aliases: [{ alias: TARGET.alias, uid: "fixture", projectId: TARGET.projectId,
      deploymentId: TARGET.priorDeploymentId, redirect: null, redirectStatusCode: null, protection_sha256: "a".repeat(64) }] };
  const intent = createIntent({ baseline, inventory, inventoryBytes, sha: "a".repeat(40), runId: "123", artifactSha256: "b".repeat(64) });
  const envelope = { kind: "deployment-share", orgId: TARGET.orgId, projectId: TARGET.projectId, deploymentId: intent.deployment_id,
    sourceSha: intent.sha, stageRunId: intent.run_id, publishAttempt: "2", issuedAt: now - 1000, expiresAt: now + 600_000,
    token: "fixture-token-not-a-real-credential" };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(readFileSync(resolve(reviewedRoot, files.includes(url.pathname.slice(1)) ? url.pathname.slice(1) : "index.html")), { status: 200, headers });
  };
  return { parent, reviewedRoot, outputRoot: resolve(parent, "canary"), inventory, inventoryBytes, intent, envelope, fetchImpl, calls };
}
function clean(f) { rmSync(f.parent, { recursive: true, force: true }); }

test("canary preserves full byte/header/provider-inventory tests and checks all five retired routes", async () => {
  const f = fixture(); try {
    const result = await runCanary(f);
    assert.equal(result.exact_bytes, true); assert.equal(result.headerCount, 10);
    assert.deepEqual(result.additional_routes, ["/formtest", "/manager"]);
    assert.equal(f.calls.length, 8);
    for (const { url, options } of f.calls) {
      assert.equal(url.origin, f.intent.deployment_url); assert.equal(options.redirect, "manual");
      assert.equal(options.headers["x-vercel-protection-bypass"], undefined);
    }
  } finally { clean(f); }
});
test("missing protected-deployment access stops on first response without bypass creation", async () => {
  const f = fixture(); let count = 0;
  try {
    await assert.rejects(runCanary({ ...f, fetchImpl: async () => { count++; return new Response("protected", { status: 401 }); } }), /CANARY_ACCESS_REQUIRED/);
    assert.equal(count, 1);
  } finally { clean(f); }
});
test("temporary credential accepts only exact already-approved short-lived envelope", () => {
  const f = fixture(); try {
    assert.equal(temporaryShareAccess(JSON.stringify(f.envelope), f.intent, "2", now), f.envelope.token);
    assert.equal(temporaryShareAccess("", f.intent, "2", now), null);
    for (const change of [
      { orgId: "team_other" }, { projectId: "prj_other" }, { deploymentId: "dpl_Other" }, { sourceSha: "b".repeat(40) },
      { stageRunId: "124" }, { publishAttempt: "1" }, { expiresAt: now }, { issuedAt: now + 1 },
      { expiresAt: now + 3_600_000 }, { token: "bad\nheader" }, { unreviewed: true }, { kind: "project-automation" },
    ]) assert.throws(() => temporaryShareAccess(JSON.stringify({ ...f.envelope, ...change }), f.intent, "2", now));
  } finally { clean(f); }
});
test("credential cannot be sent to public alias and response cookies never become artifacts", async () => {
  const f = fixture(); try {
    await assert.rejects(runCanary({ ...f, publicAlias: true, accessEnvelope: JSON.stringify(f.envelope) }), /credential-free/);
    const result = await runCanary({ ...f, publicAlias: true });
    assert.equal(result.public_alias, TARGET.alias);
    assert.ok(f.calls.every(x => x.url.origin === `https://${TARGET.alias}`));
    assert.doesNotMatch(readFileSync(resolve(f.outputRoot, "headers/index.html"), "utf8"), /set-cookie|token/i);
  } finally { clean(f); }
});
test("temporary access stays confined to exact deployment and never reaches artifacts", async () => {
  const f = fixture(); try {
    const at = Date.now(); f.envelope.issuedAt = at - 1000; f.envelope.expiresAt = at + 600_000;
    const result = await runCanary({ ...f, accessEnvelope: JSON.stringify(f.envelope), publishAttempt: "2" });
    assert.ok(f.calls.every(x => x.url.searchParams.get("_vercel_share") === f.envelope.token && x.url.origin === f.intent.deployment_url));
    assert.ok(f.calls.every(x => x.options.headers["x-vercel-protection-bypass"] === undefined));
    assert.ok(!JSON.stringify(result).includes(f.envelope.token));
    assert.ok(!readFileSync(resolve(f.outputRoot, "headers/index.html"), "utf8").includes(f.envelope.token));
  } finally { clean(f); }
});
test("share handshake permits only one same-path host-only secure cookie exchange", async () => {
  const url = new URL("https://release-forms-fixture-gemandi.vercel.app/index.html"), calls = [];
  const fetchImpl = async (target, options) => {
    calls.push({ target, options });
    return calls.length === 1 ? new Response(null, { status: 307, headers: {
      Location: "/index.html", "Set-Cookie": "_vercel_jwt=fixture.only; Path=/; Secure; HttpOnly; SameSite=Lax" } }) :
      new Response("inactive", { status: 200 });
  };
  assert.equal((await fetchShareResource({ url, token: "fixture-share", fetchImpl })).status, 200);
  assert.equal(calls.length, 2); assert.equal(calls[1].options.headers.Cookie, "_vercel_jwt=fixture.only");
  assert.equal(calls[1].target.origin, url.origin); assert.equal(calls[1].target.search, "");
  for (const [location, cookie] of [
    ["https://other.example/index.html", "_vercel_jwt=x; Secure; HttpOnly"],
    ["/other-path", "_vercel_jwt=x; Secure; HttpOnly"],
    ["/index.html?forward=secret", "_vercel_jwt=x; Secure; HttpOnly"],
    ["/index.html", "_vercel_jwt=x; Domain=.vercel.app; Secure; HttpOnly"],
    ["/index.html", "_vercel_jwt=x; Secure"],
    ["/index.html", "login=x; Secure; HttpOnly"],
  ]) {
    let count = 0;
    await assert.rejects(fetchShareResource({ url, token: "fixture-share", fetchImpl: async () => {
      count++; return new Response(null, { status: 307, headers: { Location: location, "Set-Cookie": cookie } });
    } }));
    assert.equal(count, 1);
  }
});
for (const [label, alter] of [
  ["wrong content", response => new Response("not inactive reviewed bytes", { status: 200, headers })],
  ["weakened header", response => { response.headers.set("Content-Security-Policy", "default-src *"); return response; }],
  ["duplicate header", response => { response.headers.append("X-Frame-Options", "DENY"); return response; }],
  ["redirect", response => new Response(null, { status: 308, headers: { Location: "https://example.com" } })],
]) test(`canary rejects ${label}`, async () => {
  const f = fixture(); try { await assert.rejects(runCanary({ ...f, fetchImpl: async (...args) => alter(await f.fetchImpl(...args)) })); }
  finally { clean(f); }
});
test("staged artifact hash detects filename/byte additions and rejects symlinks", () => {
  const f = fixture(); try {
    const hash = artifactDigest(f.reviewedRoot); writeFileSync(resolve(f.reviewedRoot, "extra"), "new");
    assert.notEqual(artifactDigest(f.reviewedRoot), hash);
    symlinkSync(resolve(f.reviewedRoot, "index.html"), resolve(f.reviewedRoot, "link"));
    assert.throws(() => artifactDigest(f.reviewedRoot), /symlink/);
  } finally { clean(f); }
});
