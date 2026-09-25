import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { inspectCodeqlSarif, main } from "./check-codeql-sarif.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/ci/check-codeql-sarif.mjs");
function cleanRun() {
  return { tool: { driver: { name: "CodeQL" } }, results: [], invocations: [{ executionSuccessful: true }] };
}
function cleanDocument() { return { version: "2.1.0", runs: [cleanRun()] }; }
function fixture(t, document = cleanDocument()) {
  const directory = mkdtempSync(join(tmpdir(), "codeql-gate-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  if (document !== undefined) writeFileSync(join(directory, "javascript.sarif"), JSON.stringify(document));
  return directory;
}
function runMain(t, args) {
  const output = [];
  t.mock.method(console, "log", (line) => output.push(line));
  t.mock.method(console, "error", (line) => output.push(line));
  return { status: main(args), output: output.join("\n") };
}

test("clean, complete CodeQL evidence passes, including nested files and multiple runs", (t) => {
  const document = cleanDocument();
  document.runs.push(cleanRun());
  document.runs[0].invocations.push({
    executionSuccessful: true, exitCode: 0,
    toolExecutionNotifications: [
      { level: "none", message: { text: "Extraction completed" } },
      { level: "note", message: { text: "Informational" } },
    ],
    toolConfigurationNotifications: [],
  });
  const directory = fixture(t, document);
  mkdirSync(join(directory, "nested"));
  writeFileSync(join(directory, "nested/typescript.sarif"), JSON.stringify(cleanDocument()));
  writeFileSync(join(directory, "SHA256SUMS"), "retained metadata");
  const report = inspectCodeqlSarif(directory);
  assert.equal(report.files.length, 2);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.executionProblems, []);
  assert.equal(runMain(t, [directory]).status, 0);
});

for (const [label, mutate] of [
  ["wrong version", (doc) => { doc.version = "2.0.0"; }],
  ["null document", () => null],
  ["array document", () => []],
  ["missing runs", (doc) => { delete doc.runs; }],
  ["empty runs", (doc) => { doc.runs = []; }],
  ["non-array runs", (doc) => { doc.runs = {}; }],
  ["null run", (doc) => { doc.runs = [null]; }],
  ["wrong driver", (doc) => { doc.runs[0].tool.driver.name = "Other"; }],
  ["missing tool", (doc) => { delete doc.runs[0].tool; }],
  ["missing results", (doc) => { delete doc.runs[0].results; }],
  ["non-array results", (doc) => { doc.runs[0].results = {}; }],
  ["external results", (doc) => { doc.runs[0].externalPropertyFileReferences = { results: [] }; }],
  ["missing invocations", (doc) => { delete doc.runs[0].invocations; }],
  ["empty invocations", (doc) => { doc.runs[0].invocations = []; }],
  ["non-array invocations", (doc) => { doc.runs[0].invocations = {}; }],
  ["null invocation", (doc) => { doc.runs[0].invocations = [null]; }],
  ["non-array diagnostics", (doc) => { doc.runs[0].invocations[0].toolExecutionNotifications = {}; }],
  ["null diagnostic", (doc) => { doc.runs[0].invocations[0].toolExecutionNotifications = [null]; }],
  ["missing diagnostic message", (doc) => { doc.runs[0].invocations[0].toolExecutionNotifications = [{ level: "none" }]; }],
  ["unknown diagnostic level", (doc) => { doc.runs[0].invocations[0].toolExecutionNotifications = [{ level: "okay", message: {} }]; }],
  ["null diagnostic level", (doc) => { doc.runs[0].invocations[0].toolExecutionNotifications = [{ level: null, message: {} }]; }],
]) {
  test("rejects malformed evidence: " + label, (t) => {
    const document = cleanDocument();
    const changed = mutate(document);
    const directory = fixture(t, changed === undefined ? document : changed);
    assert.throws(() => inspectCodeqlSarif(directory));
    assert.equal(runMain(t, [directory]).status, 1);
  });
}

for (const value of [false, undefined, null, "true", 1]) {
  test("requires literal successful invocation: " + String(value), (t) => {
    const document = cleanDocument();
    document.runs[0].invocations[0].executionSuccessful = value;
    const directory = fixture(t, document);
    assert.equal(inspectCodeqlSarif(directory).executionProblems.length, 1);
    assert.equal(runMain(t, [directory]).status, 1);
  });
}

for (const failure of [
  { exitCode: 2 }, { exitCode: "0" }, { processStartFailureMessage: "failed" },
  { exitSignalName: "SIGTERM" }, { exitSignalNumber: 9 },
]) {
  test("rejects contradictory successful invocation with " + Object.keys(failure)[0], (t) => {
    const document = cleanDocument();
    Object.assign(document.runs[0].invocations[0], failure);
    const directory = fixture(t, document);
    assert.equal(inspectCodeqlSarif(directory).executionProblems.length, 1);
    assert.equal(runMain(t, [directory]).status, 1);
  });
}

for (const key of ["toolExecutionNotifications", "toolConfigurationNotifications"]) {
  for (const level of ["warning", "error", undefined]) {
    test("fails " + key + " at " + String(level ?? "SARIF default warning"), (t) => {
      const document = cleanDocument();
      document.runs[0].invocations[0][key] = [{ level, message: { text: "Incomplete scan" } }];
      const directory = fixture(t, document);
      assert.equal(inspectCodeqlSarif(directory).executionProblems.length, 1);
      assert.equal(runMain(t, [directory]).status, 1);
    });
  }
}

test("rejects diagnostic exception even when its level says none", (t) => {
  const document = cleanDocument();
  document.runs[0].invocations[0].toolExecutionNotifications = [{
    level: "none", message: { text: "Unexpected exception" }, exception: {},
  }];
  const directory = fixture(t, document);
  assert.equal(inspectCodeqlSarif(directory).executionProblems.length, 1);
  assert.equal(runMain(t, [directory]).status, 1);
});

for (const result of [
  { ruleId: "js/test", level: "error" },
  { ruleId: "js/test", level: "note" },
  { ruleId: "js/test", level: "none", suppressions: [{ status: "accepted" }], baselineState: "unchanged" },
  null,
]) {
  test("fails every finding, not only a selected severity: " + JSON.stringify(result), (t) => {
    const document = cleanDocument();
    document.runs.push({ ...cleanRun(), results: [result] });
    const directory = fixture(t, document);
    assert.equal(inspectCodeqlSarif(directory).findings.length, 1);
    assert.equal(runMain(t, [directory]).status, 1);
  });
}

test("does not overlook a finding in a second SARIF file", (t) => {
  const directory = fixture(t);
  writeFileSync(join(directory, "second.sarif"), JSON.stringify({
    version: "2.1.0", runs: [{ ...cleanRun(), results: [{ ruleId: "js/test" }] }],
  }));
  assert.equal(inspectCodeqlSarif(directory).findings.length, 1);
  assert.equal(runMain(t, [directory]).status, 1);
});

test("missing directory, empty evidence, invalid JSON and regular-file root all fail", (t) => {
  const directory = fixture(t);
  const file = join(directory, "javascript.sarif");
  assert.equal(runMain(t, [join(directory, "missing")]).status, 1);
  assert.equal(main([file]), 1);
  writeFileSync(file, "{invalid");
  assert.equal(main([directory]), 1);
  rmSync(file);
  assert.equal(main([directory]), 1);
});

test("rejects root and nested symlinks instead of skipping evidence", (t) => {
  const directory = fixture(t);
  symlinkSync(directory, join(directory, "linked-root"), "dir");
  assert.equal(runMain(t, [join(directory, "linked-root")]).status, 1);
  assert.equal(main([directory]), 1);
});

test("rejects special SARIF files without opening a blocking FIFO", (t) => {
  const directory = fixture(t);
  const result = spawnSync("mkfifo", [join(directory, "special.sarif")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(runMain(t, [directory]).status, 1);
});

test("CLI defaults and exit codes fail closed; findings cannot inject workflow commands", (t) => {
  assert.equal(runMain(t, []).status, 1);
  assert.equal(main(["one", "two"]), 1);
  const directory = fixture(t);
  const accepted = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.equal(accepted.status, 0, accepted.stderr);
  const document = cleanDocument();
  document.runs[0].results = [{ message: { text: "untrusted\n::notice::not a workflow command" } }];
  writeFileSync(join(directory, "javascript.sarif"), JSON.stringify(document));
  const rejected = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /CodeQL finding:/);
  assert.doesNotMatch(rejected.stderr, /\n::notice::/);
  assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8" }).status, 1);
});

test("every CodeQL workflow runs gate tests, blocks findings, and retains evidence on failure", () => {
  for (const workflow of ["code-scanning.yml", "security-monitoring.yml"]) {
    const source = readFileSync(join(root, ".github/workflows", workflow), "utf8");
    assert.match(source, /name: Test CodeQL fail-closed gate\s+run: node --test scripts\/ci\/check-codeql-sarif\.test\.mjs/);
    assert.match(source, /upload:\s*never\s+upload-database:\s*false\s+output:\s*codeql-results/);
    assert.match(source, /node scripts\/ci\/check-codeql-sarif\.mjs codeql-results/);
    assert.doesNotMatch(source, /::warning::Validated CodeQL SARIF/);
    assert.match(source, /evidence\.json[\s\S]*node scripts\/ci\/check-codeql-sarif\.mjs/);
    assert.match(source, /- uses: actions\/upload-artifact@[a-f0-9]{40}[^\n]*\n\s+if: always\(\)\n\s+with:\n\s+name: codeql-sarif-/);
    assert.match(source, /path: codeql-results\s+if-no-files-found: error/);
    const codeqlJob = source.slice(source.indexOf("languages: javascript-typescript"));
    assert.doesNotMatch(codeqlJob, /continue-on-error:|\|\| true/);
  }
});

