#!/usr/bin/env node
// Fail closed on findings OR incomplete analysis. This validates the fields used
// for admission, not every optional field in the SARIF schema. Do not add a
// baseline, suppression, or diagnostic exception without a reviewed policy change.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function collectSarif(directory) {
  requireCondition(lstatSync(directory).isDirectory(), "SARIF root must be a real directory");
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    const stat = lstatSync(path);
    requireCondition(!stat.isSymbolicLink(), "SARIF evidence must not contain symlinks");
    if (stat.isDirectory()) files.push(...collectSarif(path));
    else if (name.endsWith(".sarif")) {
      requireCondition(stat.isFile(), "SARIF evidence must be a regular file");
      files.push(path);
    }
  }
  return files;
}

export function inspectCodeqlSarif(directory) {
  const files = collectSarif(resolve(directory));
  requireCondition(files.length > 0, "CodeQL produced no SARIF files");
  const findings = [];
  const executionProblems = [];
  for (const file of files) {
    const document = JSON.parse(readFileSync(file, "utf8"));
    requireCondition(isObject(document) && document.version === "2.1.0", "Invalid SARIF version or document");
    requireCondition(Array.isArray(document.runs) && document.runs.length > 0, "SARIF must contain nonempty runs");
    for (const [runIndex, run] of document.runs.entries()) {
      const context = { file, runIndex };
      requireCondition(isObject(run) && run.tool?.driver?.name === "CodeQL", "SARIF run must identify CodeQL");
      requireCondition(Array.isArray(run.results), "SARIF run must contain an inline results array");
      // Never mistake an external results reference for a clean inline scan.
      requireCondition(run.externalPropertyFileReferences === undefined, "External SARIF properties are not supported");
      requireCondition(Array.isArray(run.invocations) && run.invocations.length > 0, "SARIF run must record invocations");
      for (const result of run.results) {
        // Count every result, regardless of severity, baseline state or suppression.
        findings.push({ ...context, result });
      }
      for (const invocation of run.invocations) {
        requireCondition(isObject(invocation), "Invalid SARIF invocation");
        if (invocation.executionSuccessful !== true) {
          executionProblems.push({ ...context, reason: "CodeQL execution was not explicitly successful" });
        }
        if ((invocation.exitCode !== undefined && invocation.exitCode !== 0)
          || invocation.processStartFailureMessage !== undefined
          || invocation.exitSignalName !== undefined || invocation.exitSignalNumber !== undefined) {
          executionProblems.push({ ...context, reason: "CodeQL reported a process failure" });
        }
        for (const key of ["toolExecutionNotifications", "toolConfigurationNotifications"]) {
          if (invocation[key] === undefined) continue;
          requireCondition(Array.isArray(invocation[key]), "Invalid SARIF notification array");
          for (const notification of invocation[key]) {
            requireCondition(isObject(notification) && isObject(notification.message), "Invalid SARIF notification");
            // SARIF 2.1.0 section 3.58.6: an absent notification level defaults to warning.
            const level = notification.level === undefined ? "warning" : notification.level;
            requireCondition(["none", "note", "warning", "error"].includes(level), "Invalid SARIF notification level");
            if (level === "warning" || level === "error" || notification.exception !== undefined) {
              executionProblems.push({ ...context, reason: "CodeQL analysis diagnostic", level, notification });
            }
          }
        }
      }
    }
  }
  return { files, findings, executionProblems };
}

export function main(args = process.argv.slice(2)) {
  try {
    requireCondition(args.length === 1, "Usage: node scripts/ci/check-codeql-sarif.mjs <sarif-directory>");
    const report = inspectCodeqlSarif(args[0]);
    // JSON escaping keeps untrusted source/diagnostic text from becoming workflow commands.
    console.log("CodeQL gate: " + JSON.stringify({
      sarifCount: report.files.length,
      resultCount: report.findings.length,
      executionProblemCount: report.executionProblems.length,
    }));
    for (const finding of report.findings) console.error("CodeQL finding: " + JSON.stringify(finding));
    for (const problem of report.executionProblems) console.error("CodeQL execution problem: " + JSON.stringify(problem));
    return report.findings.length > 0 || report.executionProblems.length > 0 ? 1 : 0;
  } catch (error) {
    console.error("CodeQL gate rejected evidence: " + JSON.stringify(error.message));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}

