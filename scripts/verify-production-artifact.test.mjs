import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifier = resolve("scripts/verify-production-artifact.mjs");
const fixture = () => {
  const directory = mkdtempSync(resolve(tmpdir(), "release-production-artifact-"));
  mkdirSync(resolve(directory, "assets"));
  writeFileSync(resolve(directory, "index.html"), '<div id="root"></div>');
  writeFileSync(resolve(directory, "assets", "index-AbCdEf12.css"), "body{}");
  writeFileSync(resolve(directory, "assets", "index-ZyXwVu98.js"), "This standalone form is not active.");
  return directory;
};
const verify = (directory) => spawnSync(process.execPath, [verifier, directory], { encoding: "utf8" });

test("inactive production verifier accepts only the exact Vite artifact shape", () => {
  const directory = fixture();
  try {
    assert.equal(verify(directory).status, 0);
    writeFileSync(resolve(directory, "assets", "index-ZyXwVu98.js.map"), "{}");
    assert.equal(verify(directory).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inactive production verifier rejects extra paths, nested directories, and symlinks", () => {
  const extra = fixture();
  const nested = fixture();
  const linked = fixture();
  try {
    writeFileSync(resolve(extra, "robots.txt"), "unexpected");
    assert.equal(verify(extra).status, 1);

    mkdirSync(resolve(nested, "assets", "nested"));
    writeFileSync(resolve(nested, "assets", "nested", "payload.js"), "unexpected");
    assert.equal(verify(nested).status, 1);

    rmSync(resolve(linked, "assets", "index-AbCdEf12.css"));
    symlinkSync(resolve(linked, "assets", "index-ZyXwVu98.js"), resolve(linked, "assets", "index-AbCdEf12.css"));
    const result = verify(linked);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /regular non-symlink file/);
  } finally {
    rmSync(extra, { recursive: true, force: true });
    rmSync(nested, { recursive: true, force: true });
    rmSync(linked, { recursive: true, force: true });
  }
});
