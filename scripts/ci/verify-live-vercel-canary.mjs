#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const realFiles = (root, label) => {
  const stats = lstatSync(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} root must be a real non-symlink directory`);
  }
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) throw new Error(`${label} contains a symlink: ${relative(root, path)}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(root, path));
      else throw new Error(`${label} contains a non-file entry: ${relative(root, path)}`);
    }
  };
  walk(root);
  return files;
};

const parseHeaders = (path, governedNames) => {
  const values = new Map();
  for (const line of readFileSync(path, "utf8").replaceAll("\r", "").split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    if (!governedNames.has(name)) continue;
    const value = line.slice(separator + 1).trim();
    if (values.has(name)) throw new Error(`live response duplicated governed header ${name}`);
    values.set(name, value);
  }
  return values;
};

const exactInventoryKeys = [
  "complete", "deployment_id", "deployment_url", "directories", "files", "org_id", "pagination",
  "project_id", "project_name", "provider_directories", "provider_files", "schema", "source",
].sort();

const validateInventory = (inventory, reviewedFiles, reviewedDirectories, expectedIdentity) => {
  const expectedProviderFiles = [
    ".vercel/output/builds.json",
    ".vercel/output/config.json",
    ".vercel/output/diagnostics/cli_traces.json",
    ...reviewedFiles.map((path) => `.vercel/output/static/${path}`),
  ].sort();
  const expectedProviderDirectories = [
    ".vercel",
    ".vercel/output",
    ".vercel/output/diagnostics",
    ".vercel/output/static",
    ...reviewedDirectories.map((path) => `.vercel/output/static/${path}`),
  ].sort();
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory) ||
      JSON.stringify(Object.keys(inventory).sort()) !== JSON.stringify(exactInventoryKeys) ||
      inventory.schema !== 1 || inventory.source !== "vercel-v6-deployment-files" || inventory.complete !== true ||
      JSON.stringify(inventory.pagination) !== JSON.stringify({ kind: "single_recursive_tree", pages: 1, continuation: null }) ||
      inventory.org_id !== expectedIdentity.orgId || inventory.project_id !== expectedIdentity.projectId ||
      inventory.project_name !== expectedIdentity.projectName || inventory.deployment_id !== expectedIdentity.deploymentId ||
      inventory.deployment_url !== expectedIdentity.deploymentUrl || !Array.isArray(inventory.provider_files) ||
      !Array.isArray(inventory.provider_directories) || JSON.stringify(inventory.provider_files) !== JSON.stringify(expectedProviderFiles) ||
      JSON.stringify(inventory.provider_directories) !== JSON.stringify(expectedProviderDirectories) ||
      JSON.stringify(inventory.files) !== JSON.stringify(reviewedFiles) ||
      JSON.stringify(inventory.directories) !== JSON.stringify(reviewedDirectories)) {
    throw new Error("provider deployment file inventory is incomplete, unbound, or differs from the reviewed artifact");
  }
};

export function verifyLiveCanary({ reviewedRoot, liveStaticRoot, artifactHeadersRoot, routeRoot, deploymentInventory, expectedIdentity }) {
  const reviewedFiles = realFiles(reviewedRoot, "reviewed artifact");
  const reviewedDirectories = [];
  const collectDirectories = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const entry = lstatSync(path);
      if (entry.isDirectory()) {
        reviewedDirectories.push(relative(reviewedRoot, path));
        collectDirectories(path);
      }
    }
  };
  collectDirectories(reviewedRoot);
  validateInventory(deploymentInventory, reviewedFiles, reviewedDirectories, expectedIdentity);
  const liveFiles = realFiles(liveStaticRoot, "live artifact");
  if (JSON.stringify(liveFiles) !== JSON.stringify(reviewedFiles)) {
    throw new Error("live artifact file manifest differs from the exact reviewed artifact");
  }
  for (const name of reviewedFiles) {
    if (!readFileSync(resolve(reviewedRoot, name)).equals(readFileSync(resolve(liveStaticRoot, name)))) {
      throw new Error(`live artifact bytes differ from the reviewed artifact: ${name}`);
    }
  }

  const liveHeaderFiles = realFiles(artifactHeadersRoot, "live artifact headers");
  if (JSON.stringify(liveHeaderFiles) !== JSON.stringify(reviewedFiles)) {
    throw new Error("live artifact header manifest differs from the exact reviewed artifact");
  }

  const sourceConfig = JSON.parse(readFileSync(resolve(projectRoot, "vercel.json"), "utf8"));
  const headerRule = sourceConfig.headers?.find((candidate) => candidate.source === "/(.*)");
  if (!headerRule || !Array.isArray(headerRule.headers) || headerRule.headers.length !== 10) {
    throw new Error("vercel.json must declare the exact ten governed response headers");
  }
  const expectedHeaders = new Map(headerRule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  if (expectedHeaders.size !== 10) throw new Error("vercel.json contains duplicate governed response headers");

  const verifyHeaders = (path, label) => {
    const actualHeaders = parseHeaders(path, new Set(expectedHeaders.keys()));
    for (const [name, expectedValue] of expectedHeaders) {
      if (actualHeaders.get(name) !== expectedValue) {
        throw new Error(`${label} has missing or weakened ${name}`);
      }
    }
  };
  for (const name of reviewedFiles) {
    verifyHeaders(resolve(artifactHeadersRoot, name), `live artifact ${name}`);
  }

  const routeEntries = readdirSync(routeRoot).sort();
  const expectedRouteEntries = [
    "client.body", "client.headers", "client.status",
    "index.body", "index.headers", "index.status",
    "staff.body", "staff.headers", "staff.status",
  ];
  if (JSON.stringify(routeEntries) !== JSON.stringify(expectedRouteEntries)) {
    throw new Error("live route evidence manifest is missing or contains unreviewed entries");
  }
  const reviewedIndex = readFileSync(resolve(reviewedRoot, "index.html"));
  for (const label of ["index", "client", "staff"]) {
    if (readFileSync(resolve(routeRoot, `${label}.status`), "utf8").trim() !== "200") {
      throw new Error(`live ${label} route did not return HTTP 200`);
    }
    if (!readFileSync(resolve(routeRoot, `${label}.body`)).equals(reviewedIndex)) {
      throw new Error(`live ${label} route bytes differ from the reviewed inactive index`);
    }
    verifyHeaders(resolve(routeRoot, `${label}.headers`), `live ${label} route`);
  }
  return {
    files: reviewedFiles,
    routes: ["/", "/client", "/staff"],
    headerCount: expectedHeaders.size,
    provider_inventory_complete: true,
    org_id: expectedIdentity.orgId,
    project_id: expectedIdentity.projectId,
    deployment_id: expectedIdentity.deploymentId,
    deployment_url: expectedIdentity.deploymentUrl,
  };
}

async function main() {
  const [reviewedRoot, liveStaticRoot, artifactHeadersRoot, routeRoot, inventoryPath, evidencePath] = process.argv.slice(2).map((path) => path && resolve(path));
  if (!reviewedRoot || !liveStaticRoot || !artifactHeadersRoot || !routeRoot || !inventoryPath || !evidencePath) {
    throw new Error("reviewed, live-static, artifact-headers, live-routes, provider inventory, and evidence paths are required");
  }
  const inventoryBytes = readFileSync(inventoryPath);
  const deploymentInventory = JSON.parse(inventoryBytes.toString("utf8"));
  const result = verifyLiveCanary({
    reviewedRoot,
    liveStaticRoot,
    artifactHeadersRoot,
    routeRoot,
    deploymentInventory,
    expectedIdentity: {
      orgId: process.env.EXPECTED_VERCEL_ORG_ID,
      projectId: process.env.EXPECTED_VERCEL_PROJECT_ID,
      projectName: process.env.EXPECTED_VERCEL_PROJECT_NAME,
      deploymentId: process.env.DEPLOYMENT_ID,
      deploymentUrl: process.env.DEPLOYMENT_URL?.replace(/\/$/, ""),
    },
  });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(evidencePath, `${JSON.stringify({ schema: 2, ...result, provider_inventory_sha256: createHash("sha256").update(inventoryBytes).digest("hex"), exact_bytes: true, exact_headers: true, runtime: "inactive" })}\n`, { flag: "wx" });
  console.log("Verified every live inactive artifact byte and every governed header.");
}

if (process.argv[1]?.endsWith("verify-live-vercel-canary.mjs")) await main();
