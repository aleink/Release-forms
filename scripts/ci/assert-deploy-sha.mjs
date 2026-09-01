import { execFileSync } from "node:child_process";

const expected = (process.argv[2] || "").trim().toLowerCase();
if (!/^[0-9a-f]{40}$/.test(expected)) throw new Error("A full 40-character release SHA is required.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim().toLowerCase();
const head = git("rev-parse", "HEAD");
if (head !== expected) throw new Error(`Checked-out SHA ${head} does not match requested SHA ${expected}.`);
execFileSync("git", ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"], { stdio: "inherit" });
const main = git("rev-parse", "refs/remotes/origin/main");
if (main !== expected) throw new Error(`Requested SHA ${expected} is stale; origin/main is ${main}.`);
console.log(`Exact-SHA gate passed for current origin/main: ${expected}`);
