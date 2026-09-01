import assert from "node:assert/strict";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = process.argv[2] || fileURLToPath(new URL("../dist/", import.meta.url));
const topLevel = readdirSync(dist).sort();
assert.deepEqual(topLevel, ["assets", "index.html"], "production artifact top-level tree drifted");

const indexPath = join(dist, "index.html");
const assetsPath = join(dist, "assets");
const indexStats = lstatSync(indexPath);
const assetsStats = lstatSync(assetsPath);
assert.ok(indexStats.isFile() && !indexStats.isSymbolicLink(), "index.html must be a regular non-symlink file");
assert.ok(assetsStats.isDirectory() && !assetsStats.isSymbolicLink(), "assets must be a regular non-symlink directory");

const assets = readdirSync(assetsPath).sort();
assert.equal(assets.length, 2, "production artifact must contain exactly one CSS and one JavaScript asset");
const css = assets.filter((name) => /^index-[A-Za-z0-9_-]{8,}\.css$/.test(name));
const js = assets.filter((name) => /^index-[A-Za-z0-9_-]{8,}\.js$/.test(name));
assert.equal(css.length, 1, "production artifact must contain exactly one hashed CSS asset");
assert.equal(js.length, 1, "production artifact must contain exactly one hashed JavaScript asset");
for (const name of assets) {
  const stats = lstatSync(join(assetsPath, name));
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), `asset must be a regular non-symlink file: ${name}`);
}

const artifact = [indexPath, join(assetsPath, css[0]), join(assetsPath, js[0])]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

assert.match(artifact, /This standalone form is not active\./);
assert.doesNotMatch(artifact, /\.supabase\.co|submit_public_release_form|signInWithPassword/);

console.log("Verified the exact inactive production artifact tree and content boundary.");
