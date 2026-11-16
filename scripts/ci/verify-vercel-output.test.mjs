import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifier = resolve("scripts/ci/verify-vercel-output.mjs");
const sourceConfig = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
const outputSource = (source) => source === "/(.*)"
  ? "^(?:/(.*))$"
  : `^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
const routes = sourceConfig.headers.map(({ source, headers }) => ({
  src: outputSource(source),
  headers: Object.fromEntries(headers.map(({ key, value }) => [key, value])),
  continue: true,
}));
routes.push(
  { src: outputSource("/(.*)"), dest: "/index.html", check: true },
  { handle: "error" },
  { status: 404, src: "^(?!/api).*$", dest: "/404.html" },
);

const fixture = () => {
  const parent = mkdtempSync(resolve(tmpdir(), "release-vercel-output-"));
  const root = resolve(parent, "output");
  const reviewed = resolve(parent, "reviewed");
  mkdirSync(root);
  mkdirSync(reviewed);
  mkdirSync(resolve(root, "diagnostics"));
  mkdirSync(resolve(root, "static"));
  mkdirSync(resolve(root, "static", "assets"));
  mkdirSync(resolve(reviewed, "assets"));
  writeFileSync(resolve(root, "builds.json"), JSON.stringify({
    target: "production",
    cliVersion: "59.10.0",
    builds: [{
      require: "@vercel/static-build",
      use: "@vercel/static-build",
      apiVersion: 2,
      src: "package.json",
      config: { buildCommand: "npm run build", outputDirectory: "dist" },
    }],
  }));
  writeFileSync(resolve(root, "config.json"), JSON.stringify({ version: 3, routes, crons: [] }));
  writeFileSync(resolve(root, "diagnostics", "cli_traces.json"), "{}");
  const files = {
    "index.html": '<div id="root"></div>',
    "assets/index-AbCdEf12.css": "body{}",
    "assets/index-ZyXwVu98.js": "This standalone form is not active.",
  };
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(resolve(root, "static", name), contents);
    writeFileSync(resolve(reviewed, name), contents);
  }
  return { parent, reviewed, root };
};
const verify = (root, reviewed) => spawnSync(process.execPath, [verifier, root, reviewed], { encoding: "utf8" });
const retiredManifests = root => {
  const config = JSON.parse(readFileSync(resolve(root, "config.json"), "utf8"));
  config.routes.splice(1, 0, { handle: "filesystem" });
  config.framework = {slug: "vite", version: "6.4.6"};
  writeFileSync(resolve(root, "config.json"), JSON.stringify(config));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const info = { version: "20260304", runtime: "node", framework: "vite",
    runtimeVersion: { resolved: "22", requested: "22.23.x", requestedSource: "package.json" },
    dependencies: Object.entries(lock.packages).filter(([name]) => name.startsWith("node_modules/")).map(([name, p]) => ({
      name: name.slice("node_modules/".length), type: "transitive", scopes: ["prod"], resolved: p.version,
      source: "registry", sourceUrl: "https://registry.npmjs.org" })),
    buildType: "api-dir", workspace: ".", builder: "@vercel/static-build" };
  const { version, workspace, ...rest } = info;
  const project = { "@vercel/static-build:.": info };
  const deploy = { manifestVersion: "2.0", builds: { "@vercel/static-build:.": { ...rest, root: workspace, builder: info.builder } }, services: {} };
  writeFileSync(resolve(root, "diagnostics/project-manifest.json"), JSON.stringify(project));
  writeFileSync(resolve(root, "diagnostics/deploy-manifest.json"), JSON.stringify(deploy));
  return {project,deploy};
};
const verifyRetired = (root, reviewed) => spawnSync(process.execPath, [verifier, root, reviewed, "--retired-project-token"], {encoding:"utf8"});
test("retired-only mode validates real static diagnostics, does not broaden the old publisher", () => {
  const {parent,root,reviewed} = fixture();
  try {
    assert.equal(verifyRetired(root,reviewed).status,1);
    retiredManifests(root);
    assert.equal(verifyRetired(root,reviewed).status,0);
    assert.equal(verify(root,reviewed).status,1);
    mkdirSync(resolve(root,"functions"));
    assert.equal(verifyRetired(root,reviewed).status,1);
  } finally {rmSync(parent,{recursive:true,force:true});}
});
test("retired diagnostic manifests reject extra services, unpinned dependencies and mismatches", () => {
  for (const mutate of [
    ({project}) => { project.extra = {}; },
    ({project}) => { project["@vercel/static-build:."].runtime="python"; },
    ({project}) => { project["@vercel/static-build:."].dependencies[0].resolved="other"; },
    ({project}) => { project["@vercel/static-build:."].dependencies.pop(); },
    ({deploy}) => { deploy.services.extra = {}; },
    ({deploy}) => { deploy.builds["@vercel/static-build:."].root="other"; },
  ]) {
    const {parent,root,reviewed} = fixture();
    try { const docs=retiredManifests(root);mutate(docs);
      writeFileSync(resolve(root,"diagnostics/project-manifest.json"),JSON.stringify(docs.project));
      writeFileSync(resolve(root,"diagnostics/deploy-manifest.json"),JSON.stringify(docs.deploy));
      assert.equal(verifyRetired(root,reviewed).status,1);
    } finally {rmSync(parent,{recursive:true,force:true});}
  }
});
test("retired CLI format still rejects extra routes, crons, framework drift and misplaced filesystem handling", () => {
  for (const mutate of [c=>c.routes.push({src:"/extra",dest:"https://example.com"}),c=>c.crons.push({path:"/job",schedule:"* * * * *"}),
    c=>c.framework.version="other",c=>c.routes.unshift(c.routes.splice(1,1)[0]),c=>c.extra={}]) {
    const {parent,root,reviewed}=fixture();try {
      retiredManifests(root);const c=JSON.parse(readFileSync(resolve(root,"config.json")));mutate(c);
      writeFileSync(resolve(root,"config.json"),JSON.stringify(c));assert.equal(verifyRetired(root,reviewed).status,1);
    } finally {rmSync(parent,{recursive:true,force:true});}
  }
});

test("Vercel verifier accepts only the exact inactive static output tree", () => {
  const { parent, reviewed, root } = fixture();
  try {
    assert.equal(verify(root, reviewed).status, 0);
    mkdirSync(resolve(root, "functions"));
    assert.equal(verify(root, reviewed).status, 1);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Vercel verifier rejects extra routes, crons, and dynamic build metadata", () => {
  for (const mutate of [
    (config) => config.routes.unshift({ src: "/proxy", dest: "https://example.com" }),
    (config) => config.crons.push({ path: "/api/job", schedule: "* * * * *" }),
  ]) {
    const { parent, reviewed, root } = fixture();
    try {
      const config = JSON.parse(readFileSync(resolve(root, "config.json"), "utf8"));
      mutate(config);
      writeFileSync(resolve(root, "config.json"), JSON.stringify(config));
      assert.equal(verify(root, reviewed).status, 1);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("Vercel verifier rejects linked roots, linked assets, and same-name byte drift", () => {
  const fixtureData = fixture();
  const linkParent = mkdtempSync(resolve(tmpdir(), "release-vercel-output-link-"));
  const linkedRoot = resolve(linkParent, "output");
  try {
    symlinkSync(fixtureData.root, linkedRoot, "dir");
    assert.equal(verify(linkedRoot, fixtureData.reviewed).status, 1);
    rmSync(resolve(fixtureData.root, "static", "assets", "index-AbCdEf12.css"));
    symlinkSync(
      resolve(fixtureData.root, "static", "assets", "index-ZyXwVu98.js"),
      resolve(fixtureData.root, "static", "assets", "index-AbCdEf12.css"),
    );
    assert.equal(verify(fixtureData.root, fixtureData.reviewed).status, 1);
    rmSync(resolve(fixtureData.root, "static", "assets", "index-AbCdEf12.css"));
    writeFileSync(resolve(fixtureData.root, "static", "assets", "index-AbCdEf12.css"), "attacker-controlled");
    const result = verify(fixtureData.root, fixtureData.reviewed);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /differs from the reviewed build/);
  } finally {
    rmSync(linkParent, { recursive: true, force: true });
    rmSync(fixtureData.parent, { recursive: true, force: true });
  }
});
