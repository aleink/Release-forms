import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./20260806234253_security_release_remediation.sql", import.meta.url),
  "utf8",
);
const vercel = JSON.parse(readFileSync(
  new URL("../../vercel.json", import.meta.url),
  "utf8",
));

test("public submission atomically claims an unused, unexpired link", () => {
  assert.match(sql, /UPDATE public\.release_form_links[\s\S]*used_at IS NULL[\s\S]*RETURNING \* INTO v_link/);
  assert.doesNotMatch(sql, /INSERT INTO public\.release_forms[\s\S]*UPDATE public\.release_form_links/);
});

test("legal context is server-owned and semantic evidence is required", () => {
  assert.match(sql, /v_link\.service_type/);
  assert.match(sql, /v_requirement\.id/);
  assert.doesNotMatch(sql, /p_payload->>'requirement_version_id'/);
  assert.doesNotMatch(sql, /p_payload->>'service_type'/);
  assert.match(sql, /v_procedure_fields :=/);
  assert.match(sql, /Required procedure field is missing/);
  assert.match(sql, /'staff_required', v_staff_required/);
  assert.match(sql, /Required signature or consent is missing/);
  assert.match(sql, /Guardian signature is required for a minor/);
});

test("direct and concurrent inserts retain a one-submission invariant", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /release_forms_one_submission_per_link_t/);
});

test("Vercel serves direct client and staff SPA routes", () => {
  assert.deepEqual(vercel.rewrites, [{
    source: "/(.*)",
    destination: "/index.html",
  }]);
});
