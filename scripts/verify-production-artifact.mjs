import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const artifact = filesUnder(dist)
  .filter((path) => /\.(?:html|css|js)$/.test(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

assert.match(artifact, /This standalone form is not active\./);
assert.doesNotMatch(artifact, /\.supabase\.co|submit_public_release_form|signInWithPassword/);

console.log("Verified the production artifact contains only the inactive release-form landing.");
