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

test("no release payload is persisted in browser storage", () => {
  assert.doesNotMatch(client, /localStorage\.setItem|JSON\.stringify\(\[stored/);
  assert.match(client, /localStorage\.removeItem\(LEGACY_DEMO_STORAGE_KEY\)/);
  assert.match(client, /DEMO-\$\{crypto\.randomUUID\(\)\}/);
});
