import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { verifyLiveCanary } from "./verify-live-vercel-canary.mjs";

const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
const headers = config.headers[0].headers.map(({ key, value }) => `${key}: ${value}\r\n`).join("");
const expectedIdentity = {
  orgId: "team_dYh8hnyuxB6dbWOjq34jIHNg",
  projectId: "prj_AgFYzaxmaGGuLPQnxkeSfzLawwMX",
  projectName: "release-forms",
  deploymentId: "dpl_ExactCanary123",
  deploymentUrl: "https://release-forms-exact.vercel.app",
};

test("source pins the exact ten-header inactive response policy", () => {
  assert.deepEqual(Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value])), {
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'self'; manifest-src 'self'; worker-src 'none'; upgrade-insecure-requests",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  });
});

const fixture = () => {
  const parent = mkdtempSync(resolve(tmpdir(), "release-live-canary-"));
  const reviewedRoot = resolve(parent, "reviewed");
  const liveStaticRoot = resolve(parent, "live");
  const artifactHeadersRoot = resolve(parent, "artifact-headers");
  const routeRoot = resolve(parent, "routes");
  mkdirSync(resolve(reviewedRoot, "assets"), { recursive: true });
  writeFileSync(resolve(reviewedRoot, "index.html"), "This standalone form is not active.");
  writeFileSync(resolve(reviewedRoot, "assets/index-AbCdEf12.css"), "body{}");
  writeFileSync(resolve(reviewedRoot, "assets/index-ZyXwVu98.js"), "inactive");
  cpSync(reviewedRoot, liveStaticRoot, { recursive: true });
  mkdirSync(resolve(artifactHeadersRoot, "assets"), { recursive: true });
  for (const name of ["index.html", "assets/index-AbCdEf12.css", "assets/index-ZyXwVu98.js"]) {
    writeFileSync(resolve(artifactHeadersRoot, name), `HTTP/2 200\r\n${headers}\r\n`);
  }
  mkdirSync(routeRoot);
  for (const label of ["index", "client", "staff"]) {
    writeFileSync(resolve(routeRoot, `${label}.body`), readFileSync(resolve(reviewedRoot, "index.html")));
    writeFileSync(resolve(routeRoot, `${label}.headers`), `HTTP/2 200\r\n${headers}\r\n`);
    writeFileSync(resolve(routeRoot, `${label}.status`), "200\n");
  }
  const deploymentInventory = {
    schema: 1,
    source: "vercel-v6-deployment-files",
    complete: true,
    pagination: { kind: "single_recursive_tree", pages: 1, continuation: null },
    org_id: expectedIdentity.orgId,
    project_id: expectedIdentity.projectId,
    project_name: expectedIdentity.projectName,
    deployment_id: expectedIdentity.deploymentId,
    deployment_url: expectedIdentity.deploymentUrl,
    provider_files: [
      ".vercel/output/builds.json", ".vercel/output/config.json", ".vercel/output/diagnostics/cli_traces.json",
      ".vercel/output/static/assets/index-AbCdEf12.css", ".vercel/output/static/assets/index-ZyXwVu98.js",
      ".vercel/output/static/index.html",
    ],
    provider_directories: [
      ".vercel", ".vercel/output", ".vercel/output/diagnostics", ".vercel/output/static", ".vercel/output/static/assets",
    ],
    files: ["assets/index-AbCdEf12.css", "assets/index-ZyXwVu98.js", "index.html"],
    directories: ["assets"],
  };
  return { parent, reviewedRoot, liveStaticRoot, artifactHeadersRoot, routeRoot, deploymentInventory, expectedIdentity };
};

test("live canary accepts the exact complete artifact and ten-header matrix", () => {
  const data = fixture();
  try {
    assert.deepEqual(verifyLiveCanary(data), {
      files: ["assets/index-AbCdEf12.css", "assets/index-ZyXwVu98.js", "index.html"],
      routes: ["/", "/client", "/staff"],
      headerCount: 10,
      provider_inventory_complete: true,
      org_id: expectedIdentity.orgId,
      project_id: expectedIdentity.projectId,
      deployment_id: expectedIdentity.deploymentId,
      deployment_url: expectedIdentity.deploymentUrl,
    });
  } finally {
    rmSync(data.parent, { recursive: true, force: true });
  }
});

test("live canary rejects incomplete, extra-path, or wrong-deployment provider inventory", () => {
  for (const mutate of [
    (inventory) => { inventory.complete = false; },
    (inventory) => { inventory.files.push("unexpected.html"); },
    (inventory) => { inventory.provider_files.push(".vercel/output/static/unexpected.html"); },
    (inventory) => { inventory.deployment_id = "dpl_OtherCanary123"; },
    (inventory) => { inventory.pagination = { kind: "cursor", pages: 1, continuation: "more" }; },
  ]) {
    const data = fixture();
    try {
      mutate(data.deploymentInventory);
      assert.throws(() => verifyLiveCanary(data), /provider deployment file inventory is incomplete/);
    } finally {
      rmSync(data.parent, { recursive: true, force: true });
    }
  }
});

test("live canary rejects same-name byte drift and missing or extra live files", () => {
  for (const mutate of [
    ({ liveStaticRoot }) => writeFileSync(resolve(liveStaticRoot, "assets/index-AbCdEf12.css"), "attacker"),
    ({ liveStaticRoot }) => rmSync(resolve(liveStaticRoot, "assets/index-AbCdEf12.css")),
    ({ liveStaticRoot }) => writeFileSync(resolve(liveStaticRoot, "extra.html"), "extra"),
  ]) {
    const data = fixture();
    try {
      mutate(data);
      assert.throws(() => verifyLiveCanary(data), /live artifact (?:bytes|file manifest)/);
    } finally {
      rmSync(data.parent, { recursive: true, force: true });
    }
  }
});

test("live canary rejects every dropped, weakened, or duplicated governed header", () => {
  for (const { name, mutate } of [
    { name: "drop", mutate: (lines) => lines.filter((line) => !line.toLowerCase().startsWith("permissions-policy:")) },
    { name: "weaken", mutate: (lines) => lines.map((line) => line.toLowerCase().startsWith("content-security-policy:") ? "Content-Security-Policy: default-src *" : line) },
    { name: "duplicate", mutate: (lines) => [...lines, "X-Frame-Options: DENY"] },
  ]) {
    const data = fixture();
    try {
      const path = resolve(data.routeRoot, "client.headers");
      const lines = readFileSync(path, "utf8").replaceAll("\r", "").trim().split("\n");
      writeFileSync(path, `${mutate(lines).join("\r\n")}\r\n`);
      assert.throws(() => verifyLiveCanary(data), new RegExp(name === "duplicate" ? "duplicated governed header" : "missing or weakened"));
    } finally {
      rmSync(data.parent, { recursive: true, force: true });
    }
  }
});

test("live canary rejects weakened governed headers on static artifacts", () => {
  const data = fixture();
  try {
    const path = resolve(data.artifactHeadersRoot, "assets/index-AbCdEf12.css");
    writeFileSync(path, readFileSync(path, "utf8").replace("Cross-Origin-Resource-Policy: same-origin", "Cross-Origin-Resource-Policy: cross-origin"));
    assert.throws(() => verifyLiveCanary(data), /live artifact .* missing or weakened cross-origin-resource-policy/);
  } finally {
    rmSync(data.parent, { recursive: true, force: true });
  }
});
