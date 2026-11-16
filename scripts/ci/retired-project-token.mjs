#!/usr/bin/env node
// Project-scoped replacement for CLI pull/inspect. No user/team or env API.
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { apiClient, TARGET } from "./retired-single-alias.mjs";

const assert = (ok, message) => { if (!ok) throw new Error(message); };
export const EMPTY_ENV = "# Retired inactive artifact: no provider environment or credentials.\n";
export const INSTALL_ALREADY_VERIFIED = 'node -e "process.exit(0)"';
export function projectLink(project) {
  assert(project?.id === TARGET.projectId && project.accountId === TARGET.orgId && project.name === TARGET.projectName &&
    project.link == null, "Wrong project/team/name or retired Git link is not disconnected");
  assert((project.framework ?? null) === null && [null, ""].includes(project.rootDirectory ?? null) &&
    [null, "npm run build"].includes(project.buildCommand ?? null) && [null, "dist"].includes(project.outputDirectory ?? null) &&
    project.directoryListing !== true && project.nodeVersion === "24.x", "Unreviewed retired build configuration");
  // These are local build inputs, not provider configuration updates. Installation
  // already ran from package-lock without credentials. Never execute a remote
  // install/dev command, pull environment secrets, or enable analytics here.
  return { projectId: TARGET.projectId, orgId: TARGET.orgId, projectName: TARGET.projectName,
    settings: { framework: project.framework ?? null, devCommand: null,
      installCommand: INSTALL_ALREADY_VERIFIED, buildCommand: "npm run build", outputDirectory: "dist",
      rootDirectory: null, directoryListing: false, nodeVersion: project.nodeVersion } };
}
export async function prepareProject(api, cwd) {
  const link = projectLink(await api(`/v9/projects/${TARGET.projectId}`));
  // A fresh staging checkout must not contain previous links, env files or credentials.
  const directory = resolve(cwd, ".vercel");
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(resolve(directory, "project.json"), JSON.stringify(link, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(resolve(directory, ".env.production.local"), EMPTY_ENV, { flag: "wx", mode: 0o600 });
  return link;
}
export function verifyLocalLink(cwd, env = process.env) {
  for (const key of ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_SCOPE", "VERCEL_TEAM_ID"])
    assert(!env[key], "CLI scope overrides are forbidden: use only the validated local project link");
  const directory = resolve(cwd, ".vercel");
  for (const [path, kind] of [[directory, "directory"], [resolve(directory, "project.json"), "file"],
    [resolve(directory, ".env.production.local"), "file"]]) {
    const s = lstatSync(path);
    assert(!s.isSymbolicLink() && (kind === "file" ? s.isFile() : s.isDirectory()), "Local project configuration is not a regular file/directory");
  }
  const link = JSON.parse(readFileSync(resolve(directory, "project.json"), "utf8"));
  const expected = projectLink({ id: link.projectId, accountId: link.orgId, name: link.projectName,
    ...link.settings, link: null });
  assert(JSON.stringify(link) === JSON.stringify(expected), "Local project link/settings drifted");
  assert(readFileSync(resolve(directory, ".env.production.local"), "utf8") === EMPTY_ENV, "Retired build env must be empty");
  return link;
}
export async function identifyCandidate(api, url, sha) {
  assert(/^https:\/\/release-forms-[a-z0-9-]+\.vercel\.app$/.test(url ?? "") && /^[a-f0-9]{40}$/.test(sha ?? ""),
    "Invalid candidate URL or exact source SHA");
  const host = new URL(url).hostname;
  const candidate = await api(`/v13/deployments/${host}`);
  assert(/^dpl_[A-Za-z0-9]+$/.test(candidate?.id ?? "") && candidate.id !== TARGET.priorDeploymentId &&
    candidate.projectId === TARGET.projectId && candidate.ownerId === TARGET.orgId && candidate.name === TARGET.projectName &&
    candidate.url === host && candidate.readyState === "READY" && candidate.target === "production" && candidate.prebuilt === true &&
    candidate.meta?.githubCommitSha === sha, "Candidate is not the exact READY prebuilt production artifact");
  return candidate.id;
}
async function main() {
  const [mode, url] = process.argv.slice(2);
  if (mode === "check") { verifyLocalLink(process.cwd()); return; }
  const api = apiClient(process.env.VERCEL_TOKEN);
  if (mode === "prepare") await prepareProject(api, process.cwd());
  else if (mode === "identify") console.log(await identifyCandidate(api, url, process.env.RELEASE_SHA));
  else throw new Error("Expected prepare, check, or identify");
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
