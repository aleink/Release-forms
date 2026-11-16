#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = resolve(process.argv[2] || ".vercel/output");
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "../..");
const reviewedArtifactRoot = resolve(process.argv[3] || resolve(projectRoot, "dist"));
const retiredProjectToken = process.argv[4] === "--retired-project-token";
if (process.argv[4] && !retiredProjectToken) throw new Error("Unknown Vercel output verification mode");

const expectDirectory = (path, label) => {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} must be a real non-symlink directory`);
};
const expectFile = (path, label) => {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} must be a regular non-symlink file`);
};
const expectEntries = (path, expected, label) => {
  const actual = readdirSync(path).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`unexpected ${label} entries: ${actual.join(",")}`);
  }
};
const outputSource = (source) => source === "/(.*)"
  ? "^(?:/(.*))$"
  : `^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;

expectDirectory(outputRoot, "Vercel output root");
expectEntries(outputRoot, ["builds.json", "config.json", "diagnostics", "static"], "Vercel output root");
expectFile(resolve(outputRoot, "builds.json"), "Vercel builds metadata");
expectFile(resolve(outputRoot, "config.json"), "Vercel output config");
expectDirectory(resolve(outputRoot, "diagnostics"), "Vercel diagnostics");
expectEntries(resolve(outputRoot, "diagnostics"), retiredProjectToken
  ? ["cli_traces.json", "project-manifest.json", "deploy-manifest.json"] : ["cli_traces.json"], "Vercel diagnostics");
expectFile(resolve(outputRoot, "diagnostics", "cli_traces.json"), "Vercel CLI diagnostics");
if (retiredProjectToken) {
  // Genuine 59.10 static-builder diagnostics, never served runtime capabilities.
  for (const name of ["project-manifest.json", "deploy-manifest.json"])
    expectFile(resolve(outputRoot, "diagnostics", name), name);
  const manifest = JSON.parse(readFileSync(resolve(outputRoot, "diagnostics/project-manifest.json"), "utf8"));
  const deploy = JSON.parse(readFileSync(resolve(outputRoot, "diagnostics/deploy-manifest.json"), "utf8"));
  const key = "@vercel/static-build:.";
  const info = manifest[key];
  const keys = value => Object.keys(value ?? {}).sort().join(",");
  const expectedKeys = ["version", "runtime", "framework", "runtimeVersion", "dependencies", "buildType", "workspace", "builder"].sort().join(",");
  if (keys(manifest) !== key || keys(info) !== expectedKeys || info.version !== "20260304" || info.runtime !== "node" ||
    info.framework !== "vite" || info.buildType !== "api-dir" || info.workspace !== "." || info.builder !== "@vercel/static-build" ||
    JSON.stringify(info.runtimeVersion) !== JSON.stringify({ resolved: "22", requested: "22.23.x", requestedSource: "package.json" }) ||
    !Array.isArray(info.dependencies) || info.dependencies.length === 0 || info.dependencies.length > 512 ||
    keys(deploy) !== ["manifestVersion", "builds", "services"].sort().join(",") || deploy.manifestVersion !== "2.0" ||
    keys(deploy.builds) !== key || keys(deploy.services) !== "") throw new Error("Unexpected retired static diagnostic manifest");
  const { version, workspace, ...rest } = info;
  if (JSON.stringify(deploy.builds[key]) !== JSON.stringify({ ...rest, root: workspace, builder: info.builder })) {
    // Compare canonical keys because the CLI's two truthful serializations use different property order.
    const actual = deploy.builds[key];
    const expected = { ...rest, root: workspace, builder: info.builder };
    if (keys(actual) !== keys(expected) || Object.keys(expected).some(k => JSON.stringify(actual[k]) !== JSON.stringify(expected[k])))
      throw new Error("Static project/deploy diagnostic manifests disagree");
  }
  const lock = JSON.parse(readFileSync(resolve(projectRoot, "package-lock.json"), "utf8"));
  const seen = new Set();
  for (const dependency of info.dependencies) {
    const allowed = ["name", "type", "scopes", "requested", "resolved", "source", "sourceUrl"];
    const pinned = lock.packages[`node_modules/${dependency.name}`];
    if (Object.keys(dependency).some(k => !allowed.includes(k)) || typeof dependency.name !== "string" || seen.has(dependency.name) ||
      !pinned || dependency.resolved !== pinned.version || !["direct", "transitive"].includes(dependency.type) ||
      !Array.isArray(dependency.scopes) || dependency.scopes.some(s => !["prod", "dev", "optional"].includes(s)) ||
      dependency.source !== "registry" || dependency.sourceUrl !== "https://registry.npmjs.org")
      throw new Error("Static diagnostic dependency differs from the reviewed lockfile");
    seen.add(dependency.name);
  }
  const pinnedNames = Object.keys(lock.packages).filter(name => name.startsWith("node_modules/")).map(name => name.slice("node_modules/".length)).sort();
  if (JSON.stringify([...seen].sort()) !== JSON.stringify(pinnedNames)) throw new Error("Static diagnostic dependency inventory is incomplete");
}
expectDirectory(resolve(outputRoot, "static"), "Vercel static root");

const sourceConfig = JSON.parse(readFileSync(resolve(projectRoot, "vercel.json"), "utf8"));
if (JSON.stringify(Object.keys(sourceConfig).sort()) !==
    JSON.stringify(["$schema", "buildCommand", "headers", "outputDirectory", "rewrites"].sort()) ||
    sourceConfig.buildCommand !== "npm run build" || sourceConfig.outputDirectory !== "dist" ||
    !Array.isArray(sourceConfig.headers) || sourceConfig.headers.length !== 1 ||
    !Array.isArray(sourceConfig.rewrites) || sourceConfig.rewrites.length !== 1 ||
    sourceConfig.rewrites[0]?.source !== "/(.*)" || sourceConfig.rewrites[0]?.destination !== "/index.html") {
  throw new Error("vercel.json contains an unreviewed deployable capability");
}
const expectedRoutes = sourceConfig.headers.map(({ source, headers }) => ({
  src: outputSource(source),
  headers: Object.fromEntries(headers.map(({ key, value }) => [key, value])),
  continue: true,
}));
if (retiredProjectToken) expectedRoutes.push({ handle: "filesystem" });
expectedRoutes.push(
  { src: outputSource(sourceConfig.rewrites[0].source), dest: sourceConfig.rewrites[0].destination, check: true },
  { handle: "error" },
  { status: 404, src: "^(?!/api).*$", dest: "/404.html" },
);

const config = JSON.parse(readFileSync(resolve(outputRoot, "config.json"), "utf8"));
if (config.version !== 3 || !Array.isArray(config.routes) || !Array.isArray(config.crons) || config.crons.length !== 0 ||
    JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(retiredProjectToken ? ["crons", "framework", "routes", "version"] : ["crons", "routes", "version"]) ||
    (retiredProjectToken && JSON.stringify(config.framework) !== JSON.stringify({ slug: "vite", version: "6.4.6" }))) {
  throw new Error("Vercel output config must remain a static version-3 artifact without extra capabilities");
}
if (JSON.stringify(config.routes) !== JSON.stringify(expectedRoutes)) {
  throw new Error("Vercel output routes do not match the exact reviewed header and rewrite allowlist");
}

const builds = JSON.parse(readFileSync(resolve(outputRoot, "builds.json"), "utf8"));
const build = builds?.builds?.[0];
if (builds.target !== "production" || builds.cliVersion !== "59.10.0" || builds.builds.length !== 1 ||
    build.require !== "@vercel/static-build" || build.use !== "@vercel/static-build" || build.apiVersion !== 2 ||
    build.src !== "package.json" || build.config?.buildCommand !== "npm run build" || build.config?.outputDirectory !== "dist") {
  throw new Error("Vercel build metadata must remain one exact production static build");
}

const artifactVerifier = resolve(projectRoot, "scripts/verify-production-artifact.mjs");
const generatedStaticRoot = resolve(outputRoot, "static");
execFileSync(process.execPath, [artifactVerifier, generatedStaticRoot], { stdio: "inherit" });
execFileSync(process.execPath, [artifactVerifier, reviewedArtifactRoot], { stdio: "inherit" });

const regularFiles = (root) => {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error(`reviewed artifact contains a symlink: ${relative(root, path)}`);
      if (stats.isDirectory()) walk(path);
      else if (stats.isFile()) files.push(relative(root, path));
      else throw new Error(`reviewed artifact contains a non-file entry: ${relative(root, path)}`);
    }
  };
  walk(root);
  return files;
};
const reviewedFiles = regularFiles(reviewedArtifactRoot);
const generatedFiles = regularFiles(generatedStaticRoot);
if (JSON.stringify(generatedFiles) !== JSON.stringify(reviewedFiles)) {
  throw new Error("Vercel generated static file set differs from the reviewed build");
}
for (const name of reviewedFiles) {
  if (!readFileSync(resolve(generatedStaticRoot, name)).equals(readFileSync(resolve(reviewedArtifactRoot, name)))) {
    throw new Error(`Vercel generated static file differs from the reviewed build: ${name}`);
  }
}
console.log("Verified exact static-only Vercel Build Output API boundary.");
