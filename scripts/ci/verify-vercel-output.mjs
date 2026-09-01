#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = resolve(process.argv[2] || ".vercel/output");
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "../..");
const reviewedArtifactRoot = resolve(process.argv[3] || resolve(projectRoot, "dist"));

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
expectEntries(resolve(outputRoot, "diagnostics"), ["cli_traces.json"], "Vercel diagnostics");
expectFile(resolve(outputRoot, "diagnostics", "cli_traces.json"), "Vercel CLI diagnostics");
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
expectedRoutes.push(
  { src: outputSource(sourceConfig.rewrites[0].source), dest: sourceConfig.rewrites[0].destination, check: true },
  { handle: "error" },
  { status: 404, src: "^(?!/api).*$", dest: "/404.html" },
);

const config = JSON.parse(readFileSync(resolve(outputRoot, "config.json"), "utf8"));
if (config.version !== 3 || !Array.isArray(config.routes) || !Array.isArray(config.crons) || config.crons.length !== 0 ||
    JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(["crons", "routes", "version"])) {
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
