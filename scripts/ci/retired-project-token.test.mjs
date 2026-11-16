import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TARGET } from "./retired-single-alias.mjs";
import { EMPTY_ENV, INSTALL_ALREADY_VERIFIED, prepareProject, projectLink, verifyLocalLink, identifyCandidate } from "./retired-project-token.mjs";
const project = () => ({ id: TARGET.projectId, accountId: TARGET.orgId, name: TARGET.projectName, link: null,
  framework: null, rootDirectory: null, buildCommand: null, outputDirectory: null, nodeVersion: "24.x" });
test("project-only preparation uses only exact project GET, no user/team/env secrets or remote command", async () => {
  const root = mkdtempSync(join(tmpdir(), "retired-project-token-"));
  try {
    const calls = [];
    const p = { ...project(), installCommand: "untrusted install", devCommand: "untrusted dev", analytics: { id: "not-used" }, env: [{ value: "not-used" }] };
    const link = await prepareProject(async path => { calls.push(path); return p; }, root);
    assert.deepEqual(calls, [`/v9/projects/${TARGET.projectId}`]);
    assert.equal(link.settings.installCommand, INSTALL_ALREADY_VERIFIED);
    assert.equal(link.settings.nodeVersion, "24.x");
    assert.equal(link.settings.analyticsId, undefined);
    assert.equal(readFileSync(join(root, ".vercel/.env.production.local"), "utf8"), EMPTY_ENV);
    assert.deepEqual(verifyLocalLink(root, {}), link);
    await assert.rejects(prepareProject(async () => p, root), /EEXIST/);
    for (const key of ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_SCOPE", "VERCEL_TEAM_ID"])
      assert.throws(() => verifyLocalLink(root, { [key]: TARGET.orgId }), /overrides are forbidden/);
    writeFileSync(join(root, ".vercel/.env.production.local"), "UNEXPECTED=value\n");
    assert.throws(() => verifyLocalLink(root, {}), /must be empty/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("wrong owner, project, source configuration, linking and build capabilities fail closed", () => {
  for (const change of [{id:"prj_other"},{accountId:"team_other"},{name:"other"},{link:{}},
    {framework:"nextjs"},{rootDirectory:"another"},{buildCommand:"another"},{outputDirectory:"other"},
    {directoryListing:true},{nodeVersion:"18.x"}]) assert.throws(() => projectLink({...project(), ...change}));
});
test("REST inspection accepts only exact READY prebuilt source/project and never resolves account identity", async () => {
  const url = "https://release-forms-synthetic.vercel.app";
  const sha = "a".repeat(40);
  const d = { id:"dpl_Synthetic",projectId:TARGET.projectId,ownerId:TARGET.orgId,name:TARGET.projectName,
    url:new URL(url).hostname,readyState:"READY",target:"production",prebuilt:true,meta:{githubCommitSha:sha} };
  const paths = [];
  assert.equal(await identifyCandidate(async path => {paths.push(path);return d;},url,sha),d.id);
  assert.deepEqual(paths,[`/v13/deployments/${new URL(url).hostname}`]);
  for (const change of [{id:TARGET.priorDeploymentId},{projectId:"prj_other"},{ownerId:"team_other"},{name:"other"},
    {url:"another.vercel.app"},{readyState:"BUILDING"},{target:"preview"},{prebuilt:false},{meta:{githubCommitSha:"b".repeat(40)}}])
    await assert.rejects(identifyCandidate(async()=>({...d,...change}),url,sha));
  for (const bad of ["https://example.com",`${url}/`,`${url}?secret=x`,`https://user@${new URL(url).hostname}`])
    await assert.rejects(identifyCandidate(async()=>d,bad,sha));
});
