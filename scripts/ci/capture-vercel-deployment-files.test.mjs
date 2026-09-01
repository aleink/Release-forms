import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { captureDeploymentFileInventory, flattenDeploymentFileTree } from "./capture-vercel-deployment-files.mjs";

const IDS = {
  deploymentId: "dpl_ExactCanary123",
  deploymentUrl: "https://release-forms-exact.vercel.app",
  projectId: "prj_AgFYzaxmaGGuLPQnxkeSfzLawwMX",
  projectName: "release-forms",
  orgId: "team_dYh8hnyuxB6dbWOjq34jIHNg",
  token: "test-token-not-a-provider-credential",
};

const file = (name, overrides = {}) => ({ name, type: "file", uid: `uid-${name}`, mode: 0o100644, ...overrides });
const directory = (name, children, overrides = {}) => ({ name, type: "directory", mode: 0o040755, children, ...overrides });

const exactTree = () => [
  directory(".vercel", [
    directory("output", [
      file("builds.json"),
      file("config.json"),
      directory("diagnostics", [file("cli_traces.json")]),
      directory("static", [
        directory("assets", [file("index-AbCdEf12.css"), file("index-ZyXwVu98.js")]),
        file("index.html"),
      ]),
    ]),
  ]),
];

const fixture = () => {
  const parent = mkdtempSync(resolve(tmpdir(), "release-provider-tree-"));
  const reviewedRoot = resolve(parent, "reviewed");
  const prebuiltRoot = resolve(parent, ".vercel/output");
  mkdirSync(resolve(reviewedRoot, "assets"), { recursive: true });
  writeFileSync(resolve(reviewedRoot, "index.html"), "inactive");
  writeFileSync(resolve(reviewedRoot, "assets/index-AbCdEf12.css"), "body{}");
  writeFileSync(resolve(reviewedRoot, "assets/index-ZyXwVu98.js"), "inactive");
  mkdirSync(resolve(prebuiltRoot, "diagnostics"), { recursive: true });
  writeFileSync(resolve(prebuiltRoot, "builds.json"), "{}");
  writeFileSync(resolve(prebuiltRoot, "config.json"), "{}");
  writeFileSync(resolve(prebuiltRoot, "diagnostics/cli_traces.json"), "{}");
  cpSync(reviewedRoot, resolve(prebuiltRoot, "static"), { recursive: true });
  return { parent, reviewedRoot, prebuiltRoot };
};

const identity = () => ({
  id: IDS.deploymentId,
  projectId: IDS.projectId,
  ownerId: IDS.orgId,
  name: IDS.projectName,
  target: "production",
  readyState: "READY",
  prebuilt: true,
  url: "release-forms-exact.vercel.app",
});

const provider = ({ tree = exactTree(), deployment = identity(), onRequest } = {}) => async (url, options) => {
  onRequest?.(url, options);
  if (url.includes("/v13/deployments/")) return Response.json(deployment);
  if (url.includes("/v6/deployments/") && url.includes("/files?")) return Response.json(tree);
  return Response.json({ error: "not found" }, { status: 404 });
};

test("complete provider tree accepts only the exact identity, prebuilt output, and reviewed static paths", async () => {
  const data = fixture();
  const requests = [];
  try {
    const result = await captureDeploymentFileInventory({
      ...data,
      ...IDS,
      fetchImpl: provider({ onRequest: (url, options) => requests.push({ url, options }) }),
      apiOrigin: "http://127.0.0.1:43210",
    });
    assert.deepEqual(result.files, ["assets/index-AbCdEf12.css", "assets/index-ZyXwVu98.js", "index.html"]);
    assert.deepEqual(result.directories, ["assets"]);
    assert.equal(result.complete, true);
    assert.deepEqual(result.pagination, { kind: "single_recursive_tree", pages: 1, continuation: null });
    assert.equal(result.deployment_id, IDS.deploymentId);
    assert.equal(result.project_id, IDS.projectId);
    assert.equal(result.org_id, IDS.orgId);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ url }) => url.endsWith(`teamId=${IDS.orgId}`)));
    assert.ok(requests.every(({ options }) => options.headers.Authorization === `Bearer ${IDS.token}`));
  } finally {
    rmSync(data.parent, { recursive: true, force: true });
  }
});

test("workflow provider inventory gate rejects an extra remote deployed path before promotion", async () => {
  const data = fixture();
  const tree = exactTree();
  tree[0].children[0].children.find((entry) => entry.name === "static").children.push(file("unexpected.html"));
  try {
    await assert.rejects(
      captureDeploymentFileInventory({ ...data, ...IDS, fetchImpl: provider({ tree }), apiOrigin: "http://127.0.0.1:43210" }),
      /complete deployment file tree differs|deployed static path set differs/,
    );
  } finally {
    rmSync(data.parent, { recursive: true, force: true });
  }
});

test("provider inventory rejects missing files and deployment identity drift", async () => {
  for (const variant of [
    { tree: (() => { const tree = exactTree(); tree[0].children[0].children.pop(); return tree; })() },
    { deployment: { ...identity(), projectId: "prj_WrongProject123" } },
    { deployment: { ...identity(), ownerId: "team_WrongOwner123" } },
    { deployment: { ...identity(), prebuilt: false } },
  ]) {
    const data = fixture();
    try {
      await assert.rejects(
        captureDeploymentFileInventory({ ...data, ...IDS, fetchImpl: provider(variant), apiOrigin: "http://127.0.0.1:43210" }),
        /differs|not bound/,
      );
    } finally {
      rmSync(data.parent, { recursive: true, force: true });
    }
  }
});

test("provider file schema fails closed on envelopes, links, duplicates, traversal, and unknown fields", () => {
  for (const tree of [
    { files: exactTree(), pagination: { next: "cursor" } },
    [file("link", { type: "symlink" })],
    [file("same"), file("same")],
    [file("../escape")],
    [file("index.html", { unexpected: true })],
    [directory("nested", undefined)],
  ]) {
    assert.throws(() => flattenDeploymentFileTree(tree), /complete recursive array|forbidden|duplicate|unsafe|unknown|malformed/);
  }
});
