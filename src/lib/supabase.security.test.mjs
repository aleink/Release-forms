import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../pages/ClientReleaseForm.tsx", import.meta.url), "utf8");

test("production release submissions fail closed without service config or token", () => {
  assert.match(client, /if \(!supabase\) throw unavailableError\(\)/);
  assert.match(client, /if \(!token\?\.trim\(\) \|\| token === "demo"\) throw invalidTokenError\(\)/);
  assert.doesNotMatch(client, /if \(!supabase \|\| !token\)/);
});

test("demo mode requires an explicit non-production flag", () => {
  assert.match(client, /import\.meta\.env\.MODE !== "production" && demoModeRequested/);
  assert.match(client, /VITE_RELEASE_FORM_DEMO_MODE/);
  assert.match(app, /isReleaseFormDemoMode \? "\/form\/demo" : "\/staff"/);
  assert.match(form, /token === "demo" && !isReleaseFormDemoMode/);
});

test("production runtime remains inactive even if provider variables are added", () => {
  assert.match(client, /isReleaseFormRuntimeActive = import\.meta\.env\.MODE !== "production"/);
  assert.match(client, /isReleaseFormRuntimeActive && isSupabaseConfigured/);
  assert.match(app, /if \(!isReleaseFormRuntimeActive\) return <InactiveLanding \/>/);
});

test("no release payload is persisted in browser storage", () => {
  assert.doesNotMatch(client, /localStorage\.setItem|JSON\.stringify\(\[stored/);
  assert.match(client, /localStorage\.removeItem\(LEGACY_DEMO_STORAGE_KEY\)/);
  assert.match(client, /DEMO-\$\{crypto\.randomUUID\(\)\}/);
});

test("production responses apply a deny-by-default browser policy", () => {
  const vercel = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /frame-ancestors 'none'/);
  assert.match(vercel, /Referrer-Policy[^\n]+no-referrer/);
  assert.match(vercel, /Permissions-Policy/);
  assert.doesNotMatch(vercel, /unsafe-inline|unsafe-eval/);
});

test("public and login errors do not expose raw Supabase failures", () => {
  assert.doesNotMatch(client, /if \(error\) throw error/);
  assert.match(client, /throw unavailableError\(\)/);
  assert.match(client, /Email or password is incorrect\./);
});
