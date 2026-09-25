import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('./.github/workflows/security-monitoring.yml', import.meta.url), 'utf8');
const evidence = JSON.parse(readFileSync(new URL('./security/trufflehog-runtime.json', import.meta.url), 'utf8'));
const job = workflow.split('  verified-history-credentials:')[1]?.split('\n  codeql-local-sarif:')[0];
const digest = 'sha256:deb2af10659a488a14d262a323addcde099d99827a1cf1dc4e93c17915c39f08';
const image = 'ghcr.io/trufflesecurity/trufflehog';
const version = '3.97.1@' + digest;

test('official action and its transitive container runtime are pinned to reviewed immutable identities', () => {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.image, image);
  assert.equal(evidence.version, '3.97.1');
  assert.equal(evidence.manifestDigest, digest);
  assert.equal(evidence.actionCommit, '20652fbbdefffcdaa493a5bf57ab2ac6b1db715b');
  assert.equal(evidence.configRevision, evidence.actionCommit);
  assert.equal(evidence.configVersion, evidence.version);
  assert.ok(evidence.platforms.includes('linux/amd64'));
  assert.match(evidence.linuxAmd64ManifestDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(evidence.linuxAmd64ConfigDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(job);
  assert.ok(job.includes('uses: trufflesecurity/trufflehog@' + evidence.actionCommit));
  assert.equal(job.match(/^\s+image: (\S+)$/m)?.[1], image);
  assert.equal(job.match(/^\s+version: (\S+)$/m)?.[1], version);
});

test('full-history verified-secret scan scope and fail-closed behavior are unchanged', () => {
  assert.match(job, /fetch-depth: 0/);
  assert.match(job, /path: \.\//);
  assert.match(job, /base: ''/);
  assert.match(job, /head: HEAD/);
  assert.match(job, /extra_args: --results=verified\s*\n/);
  assert.doesNotMatch(job, /continue-on-error:|\|\| true|--no-verification|--no-fail|permissions:/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('jobs:')), /:\s*write(?:\s|$)|permissions:\s*write-all/);
});

test('the unchanged official IMAGE:VERSION expansion sends one tag-and-digest argument and propagates scanner failure', () => {
  // Mock only the Docker process. No image is pulled and no credentials are scanned.
  const shell = 'docker() { printf "%s\\n" "$@"; return "$FIXTURE_EXIT"; }; docker run --rm -v .:/tmp -w /tmp "${IMAGE}:${VERSION}" git file:///tmp/ --since-commit ${BASE:-\'\'} --branch ${HEAD:-\'\'} --fail --no-update --github-actions ${ARGS:-\'\'}';
  for (const exit of [0, 183]) {
    const result = spawnSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', shell], {
      encoding: 'utf8', env: { ...process.env, IMAGE: image, VERSION: version, BASE: '', HEAD: 'HEAD', ARGS: '--results=verified', FIXTURE_EXIT: String(exit) },
    });
    assert.equal(result.status, exit, result.stderr);
    const args = result.stdout.trim().split('\n');
    assert.equal(args.filter((arg) => arg === image + ':' + version).length, 1);
    for (const expected of ['git', 'file:///tmp/', '--since-commit', '--branch', 'HEAD', '--fail', '--no-update', '--github-actions', '--results=verified']) assert.ok(args.includes(expected), expected);
  }
});
