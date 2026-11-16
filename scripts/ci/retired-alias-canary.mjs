#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TARGET, digest, validateIntent } from "./retired-single-alias.mjs";
import { verifyLiveCanary } from "./verify-live-vercel-canary.mjs";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
const expectedHeaders = config.headers[0].headers;
const safePath = value => typeof value === "string" && /^[a-zA-Z0-9_./-]+$/.test(value) &&
  !value.startsWith("/") && !value.split("/").some(part => part === ".." || part === "." || part === "");

// Includes every staged build byte and path, rejects links and special files.
export function artifactDigest(root) {
  const result = createHash("sha256");
  function walk(path) {
    const entry = lstatSync(path);
    assert(!entry.isSymbolicLink(), "Staged artifact contains a symlink");
    if (entry.isDirectory()) for (const name of readdirSync(path).sort()) walk(resolve(path, name));
    else {
      assert(entry.isFile(), "Staged artifact contains a non-file entry");
      result.update(`${relative(root, path)}\0${digest(readFileSync(path))}\n`);
    }
  }
  walk(root);
  return result.digest("hex");
}

export function temporaryShareAccess(rawEnvelope, intent, publishAttempt, now = Date.now()) {
  if (!rawEnvelope) return null;
  let envelope;
  try { envelope = JSON.parse(rawEnvelope); } catch { throw new Error("Temporary canary access envelope is malformed"); }
  const allowed = ["kind", "orgId", "projectId", "deploymentId", "sourceSha", "stageRunId", "publishAttempt", "issuedAt", "expiresAt", "token"].sort();
  assert(envelope && JSON.stringify(Object.keys(envelope).sort()) === JSON.stringify(allowed) &&
    envelope.kind === "deployment-share" && envelope.orgId === TARGET.orgId && envelope.projectId === TARGET.projectId &&
    envelope.deploymentId === intent.deployment_id && envelope.sourceSha === intent.sha &&
    envelope.stageRunId === intent.run_id && envelope.publishAttempt === String(publishAttempt) &&
    typeof envelope.token === "string" && /^[A-Za-z0-9_-]{16,512}$/.test(envelope.token) &&
    Number.isSafeInteger(envelope.issuedAt) && Number.isSafeInteger(envelope.expiresAt) &&
    envelope.issuedAt <= now && now < envelope.expiresAt && envelope.expiresAt - envelope.issuedAt <= 15 * 60_000,
  "Temporary canary access does not match this exact deployment, source, run, attempt, or short validity window");
  return envelope.token;
}

// Share links can exchange their query token for a host-only share-session
// cookie. Permit only that one-hop same-origin/same-path exchange. These are
// newly approved share-session cookies, never exported browser login cookies.
export async function fetchShareResource({ url, token, fetchImpl, revalidate = () => {} }) {
  const authenticatedUrl = new URL(url);
  if (token) authenticatedUrl.searchParams.set("_vercel_share", token);
  const options = { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Mobile/15E148 Safari/604.1" } };
  let response = await fetchImpl(authenticatedUrl, options);
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  assert(token, "Unauthenticated canary redirect is not allowed");
  const location = response.headers.get("location");
  assert(typeof location === "string", "Share handshake has no redirect location");
  const destination = new URL(location, authenticatedUrl);
  assert(destination.origin === url.origin && destination.pathname === url.pathname && !destination.search && !destination.hash &&
    !destination.username && !destination.password, "Share handshake attempted an unexpected redirect");
  const cookies = response.headers.getSetCookie?.() ?? [];
  const sessions = cookies.filter(cookie => cookie.startsWith("_vercel_jwt="));
  assert(sessions.length === 1, "Share handshake did not return exactly one supported session cookie");
  const parts = sessions[0].split(";").map(part => part.trim());
  assert(/^_vercel_jwt=[A-Za-z0-9._~-]+$/.test(parts[0]) && parts.some(x => /^Secure$/i.test(x)) &&
    parts.some(x => /^HttpOnly$/i.test(x)) && !parts.some(x => /^Domain=/i.test(x)), "Share cookie is not host-only, secure and HttpOnly");
  revalidate();
  response = await fetchImpl(destination, { ...options, signal: AbortSignal.timeout(20_000), headers: { ...options.headers, Cookie: parts[0] } });
  // No redirects from the session request are followed, and the cookie dies
  // with this request. Nothing secret is written or returned to the evidence.
  return response;
}

export async function runCanary({ intent, inventory, inventoryBytes, reviewedRoot, outputRoot,
  publicAlias = false, accessEnvelope = "", publishAttempt, fetchImpl = fetch }) {
  validateIntent(intent);
  assert(digest(inventoryBytes) === intent.provider_inventory_sha256, "Staged provider inventory bytes changed");
  assert(inventory.deployment_id === intent.deployment_id && inventory.deployment_url === intent.deployment_url,
    "Provider inventory identity differs from intent");
  assert(Array.isArray(inventory.files) && inventory.files.length > 0 && inventory.files.every(safePath), "Unsafe static inventory");
  // Never send an access credential to the public alias, sibling aliases or a redirect.
  assert(!publicAlias || !accessEnvelope, "Public alias verification must be credential-free");
  const access = () => publicAlias ? null : temporaryShareAccess(accessEnvelope, intent, publishAttempt);
  access(); // Reject a mismatched or expired envelope before making any request.
  const origin = publicAlias ? `https://${TARGET.alias}` : intent.deployment_url;
  const staticRoot = resolve(outputRoot, "static"), headersRoot = resolve(outputRoot, "headers"), routeRoot = resolve(outputRoot, "routes");
  mkdirSync(outputRoot, { recursive: false });
  for (const dir of [staticRoot, headersRoot, routeRoot]) mkdirSync(dir);
  const get = async path => {
    let response;
    try {
      response = await fetchShareResource({ url: new URL(path, origin), token: access(), fetchImpl, revalidate: access });
    } catch { throw new Error("Canary request failed without following redirects; no alias mutation is authorized"); }
    assert(response.status === 200, [401, 403].includes(response.status) ?
      "CANARY_ACCESS_REQUIRED: protected staged deployment; no alias mutation attempted and no bypass created" :
      `Inactive canary returned HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    assert(body.length <= 4 * 1024 * 1024, "Canary response exceeds static artifact bound");
    // Only public governed headers are persisted. Never persist set-cookie or token material.
    const lines = expectedHeaders.map(({ key, value }) => {
      assert(response.headers.get(key) === value, `Missing or changed governed canary header: ${key}`);
      return `${key}: ${value}\r\n`;
    }).join("");
    return { body, lines };
  };
  for (const file of inventory.files) {
    const { body, lines } = await get(`/${file}`);
    for (const root of [staticRoot, headersRoot]) mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(staticRoot, file), body, { flag: "wx" });
    writeFileSync(resolve(headersRoot, file), lines, { flag: "wx" });
  }
  for (const [label, path] of [["index", "/"], ["client", "/client"], ["staff", "/staff"]]) {
    const { body, lines } = await get(path);
    writeFileSync(resolve(routeRoot, `${label}.body`), body, { flag: "wx" });
    writeFileSync(resolve(routeRoot, `${label}.headers`), lines, { flag: "wx" });
    writeFileSync(resolve(routeRoot, `${label}.status`), "200\n", { flag: "wx" });
  }
  const result = verifyLiveCanary({ reviewedRoot, liveStaticRoot: staticRoot, artifactHeadersRoot: headersRoot,
    routeRoot, deploymentInventory: inventory, expectedIdentity: { orgId: TARGET.orgId, projectId: TARGET.projectId,
      projectName: TARGET.projectName, deploymentId: intent.deployment_id, deploymentUrl: intent.deployment_url } });
  const additionalRoutes = ["/formtest", "/manager"];
  for (const path of additionalRoutes) {
    const { body } = await get(path);
    assert(body.equals(readFileSync(resolve(reviewedRoot, "index.html"))), "Retired alternate route differs from inactive artifact");
  }
  return { schema: 2, ...result, provider_inventory_sha256: digest(inventoryBytes), additional_routes: additionalRoutes,
    exact_bytes: true, exact_headers: true, runtime: "inactive", public_alias: publicAlias ? TARGET.alias : null };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "digest") { console.log(artifactDigest(resolve(args[0]))); return; }
  assert(command === "staged" || command === "public", "Expected staged or public canary");
  const [intentPath, inventoryPath, reviewedRoot, outputRoot, evidencePath] = args.map(path => resolve(path));
  const inventoryBytes = readFileSync(inventoryPath);
  const result = await runCanary({ intent: JSON.parse(readFileSync(intentPath, "utf8")), inventory: JSON.parse(inventoryBytes),
    inventoryBytes, reviewedRoot, outputRoot, publicAlias: command === "public",
    accessEnvelope: command === "public" ? "" : process.env.RETIRED_ALIAS_CANARY_ACCESS,
    publishAttempt: process.env.GITHUB_RUN_ATTEMPT });
  writeFileSync(evidencePath, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("Exact inactive static bytes, ten headers, and five routes passed.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
