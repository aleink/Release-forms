import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const app = readFileSync(new URL("App.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("lib/supabase.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("vercel.json", projectRoot), "utf8"));
const hostingStatus = readFileSync(new URL("docs/HOSTING_STATUS.md", projectRoot), "utf8");

function responseHeaders() {
  const rule = vercel.headers.find((candidate) => candidate.source === "/(.*)");
  return new Map(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

test("production builds are deliberately inactive and cannot initialize Supabase", () => {
  assert.match(client, /isReleaseFormRuntimeActive = import\.meta\.env\.MODE !== "production"/);
  assert.match(client, /isReleaseFormRuntimeActive && isSupabaseConfigured/);
  assert.match(client, /if \(!isReleaseFormRuntimeActive\) throw unavailableError\(\)/);
  assert.match(app, /if \(!isReleaseFormRuntimeActive\) return <InactiveLanding \/>/);
  assert.match(app, /This standalone form is not active\./);
});

test("Vercel publishes only the tested Vite artifact with deny-by-default headers", () => {
  const headers = responseHeaders();
  const csp = headers.get("content-security-policy") || "";
  assert.equal(vercel.outputDirectory, "dist");
  assert.equal(vercel.buildCommand, "npm run build");
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("referrer-policy"), "no-referrer");
  assert.match(headers.get("strict-transport-security") || "", /max-age=63072000/);
  assert.match(headers.get("cache-control") || "", /no-store/);
  assert.match(headers.get("x-robots-tag") || "", /noindex/);
});

test("source does not deploy the raw Vite tree through GitHub Pages", () => {
  assert.equal(existsSync(new URL(".github/workflows/pages.yml", projectRoot)), false);
  assert.match(hostingStatus, /disabled through the provider API on/);
  assert.match(hostingStatus, /returned `404`/);
  assert.doesNotMatch(hostingStatus, /Provider action still required|must disable Pages/);
  assert.match(hostingStatus, /Do not redirect/);
});
