#!/usr/bin/env node
// Execute the exact published CLI with a fake project token against loopback.
// No inherited credential/config store, live provider request, or DNS socket.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGET, captureAliases, createIntent, assignPrimary, reconcile } from "./retired-single-alias.mjs";
import { prepareProject, verifyLocalLink, identifyCandidate } from "./retired-project-token.mjs";
import { captureDeploymentFileInventory } from "./capture-vercel-deployment-files.mjs";
import { artifactDigest, runCanary } from "./retired-alias-canary.mjs";
const source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(process.argv[2] ?? "missing-cli");
assert.equal(JSON.parse(readFileSync(resolve(dirname(cli), "../package.json"))).version, "59.10.0");
const owned = mkdtempSync(join(tmpdir(), "retired-cli-offline-"));
const cwd = join(owned, "repo"); mkdirSync(cwd);
for (const name of ["package.json", "package-lock.json", "src", "index.html", "tsconfig.json", "tsconfig.node.json", "vite.config.ts", "vercel.json", "scripts"])
  cpSync(join(source, name), join(cwd, name), { recursive: true });
symlinkSync(join(source, "node_modules"), join(cwd, "node_modules"), "dir");
const config = join(owned, "empty-global-config"); mkdirSync(config);
const fake = "offline_project_fixture_not_real";
const sha = "a".repeat(40);
const fixture = { id: TARGET.projectId, accountId: TARGET.orgId, name: TARGET.projectName, link: null,
  framework: null, rootDirectory: null, nodeVersion: "24.x" };
await prepareProject(async path => { assert.equal(path, `/v9/projects/${TARGET.projectId}`); return fixture; }, cwd);
verifyLocalLink(cwd, {});
const d = { id: "dpl_OfflineSynthetic", url: "release-forms-offline-synthetic.vercel.app", projectId: TARGET.projectId,
  ownerId: TARGET.orgId, name: TARGET.projectName, target: "production", readyState: "READY", status: "READY",
  aliasAssigned: true, alias: [], prebuilt: true, meta: { githubCommitSha: sha } };
let denyStatus = 404, createCount = 0, phase = "", violations = [], calls = [], hashes = new Map();
const directory = (name, children) => ({ name, type: "directory", mode: 0o040755, children });
const providerTree = () => {
  const walk = path => readdirSync(path, { withFileTypes: true }).map(entry => entry.isDirectory()
    ? directory(entry.name, walk(join(path, entry.name)))
    : { name: entry.name, type: "file", mode: 0o100644, uid: createHash("sha1").update(readFileSync(join(path, entry.name))).digest("hex") });
  // Derived response shape: complete observed provider projection has this sole src wrapper.
  return [directory("src", [directory(".vercel", [directory("output", walk(join(cwd, ".vercel/output")))])])];
};
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(request.url, "http://127.0.0.1");
    const row = { phase, method: request.method, path: url.pathname }; calls.push(row);
    if (phase === "build") assert.ok(request.headers.authorization === undefined || request.headers.authorization === "Bearer undefined", "Build must not carry a credential");
    else assert.equal(request.headers.authorization, `Bearer ${fake}`);
    let out;
    if (url.pathname === "/v2/user" || /^\/(?:v2\/)?teams(?:\/|$)/.test(url.pathname)) {
      response.statusCode = denyStatus; out = { error: { code: "not_found", message: "Project token cannot access account resources" } };
    } else if (phase.startsWith("unsupported-")) {
      // Negative commands are not allowed any mutation or fallback discovery.
      assert.equal(request.method, "GET"); response.statusCode = 403;
      out = { error: { code: "not_authorized", message: "Unsupported account-discovery path" } };
    } else {
      assert.equal(url.searchParams.get("teamId"), TARGET.orgId);
      if (request.method === "GET" && url.pathname === `/v9/projects/${TARGET.projectId}`) out = fixture;
      else if (request.method === "POST" && url.pathname === "/v13/deployments") {
        createCount++; const body = JSON.parse(raw);
        assert.equal(url.searchParams.get("prebuilt"), "1");
        assert.equal(body.project, TARGET.projectId); assert.equal(body.name, TARGET.projectName);
        assert.equal(body.target, "production"); assert.equal(body.autoAssignCustomDomains, false);
        assert.equal(body.meta.githubCommitSha, sha); assert.deepEqual(body.env, {}); assert.deepEqual(body.build.env, {});
        assert.ok(!body.alias && !body.gitSource && !body.forceNew);
        for (const file of body.files) {
          assert.ok(file.file.startsWith(".vercel/output/"));
          const bytes = readFileSync(join(cwd, file.file));
          assert.equal(createHash("sha1").update(bytes).digest("hex"), file.sha);
          assert.equal(bytes.length, file.size); hashes.set(file.sha, bytes);
        }
        if (createCount === 1) { response.statusCode = 400;
          out = { error: { code: "missing_files", message: "Fixture requires upload", missing: [...hashes.keys()] } };
        } else { assert.equal(createCount, 2); out = { ...d, readyState: "QUEUED", aliasAssigned: false }; }
      } else if (request.method === "POST" && url.pathname === "/v2/files") {
        assert.deepEqual(raw, hashes.get(request.headers["x-now-digest"])); out = {};
      } else if (request.method === "GET" && url.pathname === `/v13/deployments/${d.id}`) out = d;
      else if (request.method === "GET" && url.pathname === `/v6/deployments/${d.id}/files`) out = providerTree();
      else if (request.method === "GET" && url.pathname === `/v3/now/deployments/${d.id}/events`) out = [];
      else throw new Error("Unexpected endpoint");
    }
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(out));
  } catch (error) { violations.push(error.message); response.statusCode = 500; response.end('{"error":{"code":"fixture_failed","message":"Mock contract failed"}}'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
async function run(args, credential = true) {
  const processEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, CI: "1", VERCEL_TELEMETRY_DISABLED: "1",
    NO_UPDATE_NOTIFIER: "1", RETIRED_MOCK_PORT: String(port),
    NODE_OPTIONS: `--require=${join(source, "scripts/ci/retired-cli-network-guard.cjs")}`,
    ...(credential ? { VERCEL_TOKEN: fake } : {}) };
  const child = spawn(process.execPath, [cli, ...args, "--api", `http://127.0.0.1:${port}`, "--global-config", config],
    { cwd, env: processEnv, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", x => { output += x; }); child.stderr.on("data", x => { output += x; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
  const code = await new Promise(resolve => child.on("exit", resolve)); clearTimeout(timer);
  assert.ok(!output.includes(fake), "CLI logged the fake credential");
  assert.ok(!output.includes("OFFLINE_NETWORK_DENIED"), "CLI attempted forbidden network access");
  return { code, output };
}
try {
  phase = "build"; const build = await run(["build", "--prod"], false);
  assert.equal(build.code, 0, build.output);
  assert.ok(calls.every(row => row.path === "/v2/user"), "Build may only make the CLI's optional unauthenticated startup lookup");
  assert.deepEqual(violations, []);
  execFileSync(process.execPath, [join(source, "scripts/ci/verify-vercel-output.mjs"), join(cwd, ".vercel/output"), join(cwd, "dist"), "--retired-project-token"]);
  const tree = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? tree(join(directory, entry.name)) : [[join(directory, entry.name), readFileSync(join(directory, entry.name))]]);
  const before = tree(join(cwd, ".vercel/output"));
  for (const status of [404, 403]) {
    denyStatus = status; createCount = 0; hashes = new Map(); phase = `deploy-deny-${status}`;
    const start = calls.length;
    const result = await run(["deploy", "--prebuilt", "--prod", "--skip-domain", "--yes", "--meta", `githubCommitSha=${sha}`]);
    assert.equal(result.code, 0, result.output); assert.match(result.output, /release-forms-offline-synthetic\.vercel\.app/);
    assert.equal(createCount, 2); assert.deepEqual(violations, []);
    const slice = calls.slice(start);
    assert.ok(slice.some(x => x.path === "/v2/user")); // Optional denied startup lookup is harmless, not granted.
    assert.ok(!slice.some(x => /teams/.test(x.path)));
    assert.equal(slice.filter(x => x.path === "/v2/files").length, hashes.size);
    assert.ok(slice.some(x => x.path === `/v13/deployments/${d.id}`));
    assert.deepEqual(tree(join(cwd, ".vercel/output")), before, "CLI changed sealed prebuilt bytes");
  }
  phase = "full-governed-pipeline";
  const inventory = await captureDeploymentFileInventory({ reviewedRoot: join(cwd,"dist"), prebuiltRoot: join(cwd,".vercel/output"),
    deploymentId:d.id,deploymentUrl:`https://${d.url}`,projectId:TARGET.projectId,projectName:TARGET.projectName,orgId:TARGET.orgId,
    token:fake,apiOrigin:`http://127.0.0.1:${port}`,retiredProjectToken:true });
  assert.equal(inventory.schema,2);assert.equal(inventory.provider_path_prefix,"src/");assert.equal(inventory.provider_files.length,8);
  const inventoryBytes=Buffer.from(JSON.stringify(inventory));
  const aliases=Array.from({length:21},(_,i)=>({alias:i===0?TARGET.alias:`release-forms-sibling-${i}.vercel.app`,uid:`fixture-${i}`,
    projectId:TARGET.projectId,deploymentId:i===0?TARGET.priorDeploymentId:`dpl_DifferentSibling${i}`,redirect:null,redirectStatusCode:null}));
  const originalSiblings=structuredClone(aliases.slice(1));let writes=0,attemptRecorded=false;
  const api=async(path,body)=>{
    if(body){assert.equal(path,`/v2/deployments/${d.id}/aliases`);assert.deepEqual(body,{alias:TARGET.alias,redirect:null});
      assert.equal(attemptRecorded,true);writes++;assert.equal(writes,1);aliases[0].deploymentId=d.id;return{alias:TARGET.alias,uid:aliases[0].uid};}
    if(path===`/v9/projects/${TARGET.projectId}`)return fixture;
    if(path.startsWith("/v4/aliases?"))return{aliases:structuredClone(aliases),pagination:{count:21,next:null}};
    if(path.startsWith(`/v4/aliases/${TARGET.alias}?`))return structuredClone(aliases[0]);
    if(path===`/v13/deployments/${d.id}`)return d;
    if(path===`/v13/deployments/${TARGET.priorDeploymentId}`)return{...d,id:TARGET.priorDeploymentId,meta:{githubCommitSha:TARGET.priorSourceSha}};
    throw new Error("Unexpected offline release API");
  };
  const baseline=await captureAliases(api);
  const intent=createIntent({baseline,inventory,inventoryBytes,sha,runId:"123",artifactSha256:artifactDigest(join(cwd,".vercel/output"))});
  const headers=Object.fromEntries(JSON.parse(readFileSync(join(cwd,"vercel.json"))).headers[0].headers.map(h=>[h.key,h.value]));
  const http=async(url,options)=>{
    assert.ok([`https://${d.url}`,`https://${TARGET.alias}`].includes(url.origin));
    assert.equal(url.search,"");assert.equal(options.redirect,"manual");assert.ok(!options.headers?.Authorization && !options.headers?.Cookie);
    const file=inventory.files.includes(url.pathname.slice(1))?url.pathname.slice(1):"index.html";
    return new Response(readFileSync(join(cwd,"dist",file)),{status:200,headers});
  };
  const canaryArgs={intent,inventory,inventoryBytes,reviewedRoot:join(cwd,"dist"),fetchImpl:http};
  const staged=await runCanary({...canaryArgs,outputRoot:join(owned,"staged-canary")});assert.equal(writes,0);
  const assigned=await assignPrimary({api,intent,canary:staged,confirmation:`CHANGE ONLY ${TARGET.alias}`,recordAttempt:()=>{attemptRecorded=true;}});
  assert.equal(assigned.status,"alias_assigned");assert.equal(writes,1);
  const publicResult=await runCanary({...canaryArgs,publicAlias:true,outputRoot:join(owned,"public-canary")});
  assert.equal(publicResult.public_alias,TARGET.alias);assert.equal(publicResult.exact_bytes,true);assert.equal(publicResult.headerCount,10);
  assert.equal((await reconcile(api,intent)).status,"candidate_mapped");assert.deepEqual(aliases.slice(1),originalSiblings);
  const refreshed=await captureDeploymentFileInventory({reviewedRoot:join(cwd,"dist"),prebuiltRoot:join(cwd,".vercel/output"),
    deploymentId:d.id,deploymentUrl:`https://${d.url}`,projectId:TARGET.projectId,projectName:TARGET.projectName,orgId:TARGET.orgId,
    token:fake,apiOrigin:`http://127.0.0.1:${port}`,retiredProjectToken:true});
  assert.equal(JSON.stringify(refreshed),inventoryBytes.toString());
  phase = "unsupported-pull"; assert.notEqual((await run(["pull", "--yes", "--environment=production"])).code, 0);
  phase = "unsupported-inspect"; assert.notEqual((await run(["inspect", d.url, "--json"])).code, 0);
  phase = "unsupported-scope"; assert.notEqual((await run(["deploy", "--prebuilt", "--prod", "--skip-domain", "--scope=gemandi"])).code, 0);
  assert.equal(await identifyCandidate(async path => {assert.equal(path, `/v13/deployments/${d.url}`);return d;}, `https://${d.url}`, sha),d.id);
  assert.deepEqual(violations, []);
  console.log(JSON.stringify({ cli: "59.10.0", build: "credential-free, optional unauthenticated startup lookup denied", deploy: "upload + status passed with account resources denied 404 and 403",
    noTeamAccess: true, sealedBytesUnchanged: true, legacyPullInspectScope: "correctly rejected",
    fullPipeline:"wrapped 8-file inventory → source-bound intent → staged/public exact-byte ten-header canaries → ONE mock alias assignment → all21 mapping reconciliation",
    requests: calls }, null, 2));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(owned, { recursive: true, force: true }); }
