import { execFileSync } from "node:child_process";
import fs from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
const skip = /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|eot|mp4|mov)$/i;
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["GitHub token", /gh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}/g],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{50,}/g],
  ["Supabase access token", /sbp_[A-Za-z0-9]{30,}/g],
  ["Supabase secret key", /sb_secret_(?!test-only-not-a-real-secret)[A-Za-z0-9_-]{20,}/g],
  ["Vercel token", /(?:VERCEL_TOKEN\s*[=:]\s*["']?)(?!\$\{\{|process\.env)[A-Za-z0-9_-]{20,}/gi],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/g],
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ["credential URL", /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@]+:[^\s@]+@/gi]
];
const findings = [];
for (const file of files) {
  if (skip.test(file)) continue;
  const stat = fs.statSync(file);
  if (stat.size > 1_500_000) throw new Error(`Credential scan refused oversized tracked text file: ${file}`);
  const raw = fs.readFileSync(file);
  if (raw.includes(0)) continue;
  const text = raw.toString("utf8");
  for (const [kind, pattern] of patterns) { pattern.lastIndex = 0; if (pattern.test(text)) findings.push(`${file}: ${kind}`); }
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(match[0].split(".")[1], "base64url").toString("utf8")).role === "service_role") findings.push(`${file}: Supabase service_role JWT`); } catch {}
  }
}
if (findings.length) throw new Error(`Potential credentials in tracked source (values suppressed):\n${[...new Set(findings)].join("\n")}`);
console.log(`Credential scan passed for ${files.length} tracked files.`);
