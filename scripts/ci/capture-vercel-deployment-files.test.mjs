import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { captureDeploymentFileInventory, flattenDeploymentFileTree, matchProviderTree } from "./capture-vercel-deployment-files.mjs";

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

test("observed complete connector evidence derives only one exact src source envelope", async () => {
  const observed = JSON.parse(readFileSync(new URL("./fixtures/vercel-files-43855846015.connector.json", import.meta.url)));
  assert.deepEqual(observed.context,{totalFiles:8,returnedFiles:8,truncated:false});
  assert.match(observed.provenance,/NOT a raw recursive/);
  const tree = [];
  for (const row of observed.files) {
    const segments = row.path.split("/"); let level = tree;
    for (const segment of segments.slice(0,-1)) {
      let next=level.find(n=>n.name===segment);
      if (!next) {next=directory(segment,[]);level.push(next);} level=next.children;
    }
    level.push(file(segments.at(-1),{uid:row.uid}));
  }
  const raw=flattenDeploymentFileTree(tree);
  assert.deepEqual(raw.files,observed.files.map(x=>x.path).sort());
  const expected={files:raw.files.map(x=>x.slice(4)),directories:raw.directories.filter(x=>x!=="src").map(x=>x.slice(4))};
  assert.equal(matchProviderTree(raw,expected,true),"src/");
  assert.throws(()=>matchProviderTree(raw,expected,false),/differs/);
});

test("retired capture preserves all raw paths and explicit format while old mode remains strict", async () => {
  const data=fixture();const tree=exactTree();
  for (const name of ["deploy-manifest.json","project-manifest.json"]) {
    tree[0].children[0].children.find(x=>x.name==="diagnostics").children.push(file(name));
    writeFileSync(resolve(data.prebuiltRoot,"diagnostics",name),"{}");
  }
  try {
    for (const prefix of ["", "src/"]) {
      const wrapped=prefix?[directory("src",tree)]:tree;
      const receipt=await captureDeploymentFileInventory({...data,...IDS,retiredProjectToken:true,fetchImpl:provider({tree:wrapped})});
      assert.equal(receipt.schema,2);assert.equal(receipt.prebuilt_format,"retired-cli-59.10.0");
      assert.equal(receipt.provider_path_prefix,prefix);
      assert.deepEqual(receipt.provider_files,flattenDeploymentFileTree(wrapped).files);
      assert.deepEqual(receipt.provider_directories,flattenDeploymentFileTree(wrapped).directories);
      assert.deepEqual(receipt.files,["assets/index-AbCdEf12.css","assets/index-ZyXwVu98.js","index.html"]);
    }
    await assert.rejects(captureDeploymentFileInventory({...data,...IDS,fetchImpl:provider({tree:[directory("src",tree)]})}),/differs/);
  } finally {rmSync(data.parent,{recursive:true,force:true});}
});

test("source-envelope comparison rejects mixed prefixes, extras, functions and empty extra directories", () => {
  const expected=flattenDeploymentFileTree(exactTree());
  for (const tree of [
    [directory("src",exactTree()),...exactTree()], [directory("src",[...exactTree(),file("secret.env")])],
    [directory("src",exactTree()),directory("extra",[])], [directory("src",[directory("src",exactTree())])],
    [directory("src",[...exactTree(),directory("functions",[])])], [directory("source",exactTree())],
    [directory("src",[...exactTree(),directory("empty",[])])],
  ]) {
    let error;try {matchProviderTree(flattenDeploymentFileTree(tree),expected,true);} catch(e){error=e;}
    assert.match(error.message,/differs/);
    assert.equal(error.inventoryDiagnostics.reason,"exact-provider-tree-mismatch");
    assert.deepEqual(error.inventoryDiagnostics.provider_file_path_sha256,flattenDeploymentFileTree(tree).files.map(path=>createHash("sha256").update(path).digest("hex")));
    for(const path of flattenDeploymentFileTree(tree).files)assert.ok(!JSON.stringify(error.inventoryDiagnostics).includes(path));
    assert.ok(!JSON.stringify(error.inventoryDiagnostics).includes(IDS.token));
  }
});

test("retired capture rejects a matching but expanded local/provider capability tree", async () => {
  const data=fixture();const tree=exactTree();
  for(const name of ["deploy-manifest.json","project-manifest.json"]){
    tree[0].children[0].children.find(x=>x.name==="diagnostics").children.push(file(name));
    writeFileSync(resolve(data.prebuiltRoot,"diagnostics",name),"{}");
  }
  mkdirSync(resolve(data.prebuiltRoot,"functions"));
  tree[0].children[0].children.push(directory("functions",[]));
  try{await assert.rejects(captureDeploymentFileInventory({...data,...IDS,retiredProjectToken:true,
    fetchImpl:provider({tree:[directory("src",tree)]})}),/exact static-only CLI output/);
    await assert.rejects(captureDeploymentFileInventory({...data,...IDS,projectId:"prj_other",retiredProjectToken:true,
      fetchImpl:()=>{throw Error("must not call");}}),/limited to the exact retired project/);
  }finally{rmSync(data.parent,{recursive:true,force:true});}
});

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
