#!/usr/bin/env node
import { lstatSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://api.vercel.com";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TREE_ENTRIES = 256;
const MAX_TREE_DEPTH = 16;
const PREBUILT_PREFIX = ".vercel/output";
const STATIC_PREFIX = `${PREBUILT_PREFIX}/static/`;
const ID_PATTERN = /^(?:dpl|prj|team)_[A-Za-z0-9]+$/;

const assertIdentifier = (value, prefix, label) => {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || !value.startsWith(`${prefix}_`)) {
    throw new Error(`${label} is not a valid ${prefix} identifier`);
  }
  return value;
};

const normalizeDeploymentUrl = (value) => {
  if (typeof value !== "string") throw new Error("deployment URL is required");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash ||
      !/^[A-Za-z0-9.-]+[.]vercel[.]app$/.test(url.hostname)) {
    throw new Error("deployment URL must be one exact HTTPS vercel.app origin");
  }
  return `https://${url.hostname}`;
};

const realTree = (root, label) => {
  const rootStats = lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`${label} root must be a real non-symlink directory`);
  }
  const files = [];
  const directories = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const stats = lstatSync(path);
      const rel = relative(root, path).split(sep).join("/");
      if (stats.isSymbolicLink()) throw new Error(`${label} contains a symlink: ${rel}`);
      if (stats.isDirectory()) {
        directories.push(rel);
        walk(path);
      } else if (stats.isFile()) {
        files.push(rel);
      } else {
        throw new Error(`${label} contains a non-file entry: ${rel}`);
      }
    }
  };
  walk(root);
  return { files, directories };
};

const validateName = (name) => {
  if (typeof name !== "string" || name.length === 0 || name.length > 255 || name === "." || name === ".." ||
      name.includes("/") || name.includes("\\") || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("deployment file tree contains an unsafe path segment");
  }
};

export const flattenDeploymentFileTree = (tree) => {
  if (!Array.isArray(tree)) {
    throw new Error("Vercel deployment file inventory must be the complete recursive array response");
  }
  const files = [];
  const directories = [];
  const seen = new Set();
  let entries = 0;
  const walk = (nodes, parent, depth) => {
    if (!Array.isArray(nodes) || depth > MAX_TREE_DEPTH) {
      throw new Error("Vercel deployment file inventory is malformed or too deep");
    }
    for (const node of nodes) {
      entries += 1;
      if (entries > MAX_TREE_ENTRIES || !node || typeof node !== "object" || Array.isArray(node)) {
        throw new Error("Vercel deployment file inventory is malformed or too large");
      }
      const allowedKeys = new Set(["name", "type", "uid", "children", "contentType", "mode"]);
      if (Object.keys(node).some((key) => !allowedKeys.has(key))) {
        throw new Error("Vercel deployment file inventory contains an unknown field");
      }
      validateName(node.name);
      if (!Number.isSafeInteger(node.mode) || node.mode < 0) {
        throw new Error("Vercel deployment file inventory contains an invalid mode");
      }
      const path = parent ? `${parent}/${node.name}` : node.name;
      if (seen.has(path)) throw new Error(`Vercel deployment file inventory contains a duplicate path: ${path}`);
      seen.add(path);
      if (node.type === "directory") {
        if (node.uid !== undefined || !Array.isArray(node.children)) {
          throw new Error(`Vercel directory entry is malformed: ${path}`);
        }
        directories.push(path);
        walk(node.children, path, depth + 1);
      } else if (node.type === "file") {
        if (typeof node.uid !== "string" || node.uid.length === 0 || node.uid.length > 256 || node.children !== undefined) {
          throw new Error(`Vercel file entry is malformed: ${path}`);
        }
        files.push(path);
      } else {
        throw new Error(`Vercel deployment contains a forbidden ${String(node.type)} entry: ${path}`);
      }
    }
  };
  walk(tree, "", 0);
  return { files: files.sort(), directories: directories.sort() };
};

const readJsonResponse = async (response, label) => {
  if (!response || typeof response.arrayBuffer !== "function") throw new Error(`${label} returned an invalid response`);
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error(`${label} response is too large`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error(`${label} response is too large`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
};

const fetchJson = async (fetchImpl, url, token, label) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: controller.signal,
    });
    return await readJsonResponse(response, label);
  } finally {
    clearTimeout(timeout);
  }
};

export async function captureDeploymentFileInventory({
  reviewedRoot,
  prebuiltRoot,
  deploymentId,
  deploymentUrl,
  projectId,
  projectName,
  orgId,
  token,
  fetchImpl = fetch,
  apiOrigin = API_ORIGIN,
}) {
  assertIdentifier(deploymentId, "dpl", "deployment ID");
  assertIdentifier(projectId, "prj", "project ID");
  assertIdentifier(orgId, "team", "organization ID");
  if (typeof projectName !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(projectName)) {
    throw new Error("project name is invalid");
  }
  if (typeof token !== "string" || token.length === 0) throw new Error("Vercel token is required");
  const normalizedUrl = normalizeDeploymentUrl(deploymentUrl);
  if (apiOrigin !== API_ORIGIN && !apiOrigin.startsWith("http://127.0.0.1:")) {
    throw new Error("untrusted Vercel API origin");
  }

  const teamQuery = `teamId=${encodeURIComponent(orgId)}`;
  const identity = await fetchJson(
    fetchImpl,
    `${apiOrigin}/v13/deployments/${encodeURIComponent(deploymentId)}?${teamQuery}`,
    token,
    "Vercel deployment identity",
  );
  if (!identity || typeof identity !== "object" || Array.isArray(identity) || identity.id !== deploymentId ||
      identity.projectId !== projectId || identity.ownerId !== orgId || identity.name !== projectName ||
      identity.target !== "production" || identity.readyState !== "READY" || identity.prebuilt !== true ||
      `https://${identity.url}` !== normalizedUrl) {
    throw new Error("Vercel deployment identity is not bound to the exact ready prebuilt project canary");
  }

  const treeResponse = await fetchJson(
    fetchImpl,
    `${apiOrigin}/v6/deployments/${encodeURIComponent(deploymentId)}/files?${teamQuery}`,
    token,
    "Vercel deployment file inventory",
  );
  const remote = flattenDeploymentFileTree(treeResponse);
  const localOutput = realTree(prebuiltRoot, "reviewed Vercel prebuilt output");
  const expectedProviderFiles = localOutput.files.map((path) => `${PREBUILT_PREFIX}/${path}`).sort();
  const expectedProviderDirectories = [".vercel", PREBUILT_PREFIX, ...localOutput.directories.map((path) => `${PREBUILT_PREFIX}/${path}`)].sort();
  if (JSON.stringify(remote.files) !== JSON.stringify(expectedProviderFiles) ||
      JSON.stringify(remote.directories) !== JSON.stringify(expectedProviderDirectories)) {
    throw new Error("Vercel complete deployment file tree differs from the exact reviewed prebuilt output");
  }

  const reviewed = realTree(reviewedRoot, "reviewed static artifact");
  const servedFiles = remote.files.filter((path) => path.startsWith(STATIC_PREFIX)).map((path) => path.slice(STATIC_PREFIX.length)).sort();
  const servedDirectories = remote.directories.filter((path) => path.startsWith(STATIC_PREFIX)).map((path) => path.slice(STATIC_PREFIX.length)).sort();
  if (JSON.stringify(servedFiles) !== JSON.stringify(reviewed.files) ||
      JSON.stringify(servedDirectories) !== JSON.stringify(reviewed.directories)) {
    throw new Error("Vercel complete deployed static path set differs from the exact reviewed artifact");
  }

  return {
    schema: 1,
    source: "vercel-v6-deployment-files",
    complete: true,
    pagination: { kind: "single_recursive_tree", pages: 1, continuation: null },
    org_id: orgId,
    project_id: projectId,
    project_name: projectName,
    deployment_id: deploymentId,
    deployment_url: normalizedUrl,
    provider_files: remote.files,
    provider_directories: remote.directories,
    files: servedFiles,
    directories: servedDirectories,
  };
}

async function main() {
  const [reviewedRoot, prebuiltRoot, evidencePath] = process.argv.slice(2).map((path) => path && resolve(path));
  if (!reviewedRoot || !prebuiltRoot || !evidencePath) {
    throw new Error("reviewed artifact, prebuilt output, and evidence paths are required");
  }
  const result = await captureDeploymentFileInventory({
    reviewedRoot,
    prebuiltRoot,
    deploymentId: process.env.DEPLOYMENT_ID,
    deploymentUrl: process.env.DEPLOYMENT_URL,
    projectId: process.env.EXPECTED_VERCEL_PROJECT_ID,
    projectName: process.env.EXPECTED_VERCEL_PROJECT_NAME,
    orgId: process.env.EXPECTED_VERCEL_ORG_ID,
    token: process.env.VERCEL_TOKEN,
  });
  writeFileSync(evidencePath, `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
  console.log("Captured and verified the complete provider deployment file tree.");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
