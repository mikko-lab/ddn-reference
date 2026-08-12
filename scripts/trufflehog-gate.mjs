#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';

const TRUFFLEHOG_VERSION = 'trufflehog 3.96.0';
const TRUFFLEHOG_DARWIN_ARM64_ARCHIVE_SHA256 = '87478306b95ca2420cfb844b7582383ac60b922e262350a0088e797f328d2e62';
const TRUFFLEHOG_DARWIN_ARM64_BINARY_SHA256 = '09c30c73bf4a265942c4a3e1a889833464c01db18fb4e53002220baa3367eb5d';
const FINDING_EXIT_CODE = 183;

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalized(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function findingKey(finding) {
  return `${finding.detector}\0${finding.path}\0${finding.line}\0${finding.fingerprintSha256}`;
}

function runScan(binary, source) {
  const result = spawnSync(
    binary,
    [
      'filesystem',
      source,
      '--json',
      '--no-update',
      '--no-verification',
      '--results=verified,unknown,unverified,filtered_unverified',
      '--fail',
      '--fail-on-scan-errors',
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } }
  );
  if (result.error) throw result.error;
  if (![0, FINDING_EXIT_CODE].includes(result.status)) {
    throw new Error(`trufflehog execution failed with status ${result.status}; output intentionally suppressed`);
  }
  const findings = result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(result.status, findings.length > 0 ? FINDING_EXIT_CODE : 0, 'trufflehog status/report mismatch');
  return findings;
}

const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    source: { type: 'string' },
  },
});
if (!values.binary || !values.source) {
  throw new Error('usage: trufflehog-gate --binary <verified trufflehog binary> --source <history-free snapshot>');
}

const binary = resolve(values.binary);
const source = resolve(values.source);
if (!existsSync(binary)) throw new Error('trufflehog binary does not exist');
if (!existsSync(join(source, 'public-snapshot-manifest.json'))) throw new Error('snapshot manifest is missing from source');
if (existsSync(join(source, '.git'))) throw new Error('source must be a history-free snapshot, not a Git worktree');
if (sha256(binary) !== TRUFFLEHOG_DARWIN_ARM64_BINARY_SHA256) {
  throw new Error('trufflehog binary SHA-256 mismatch');
}
const version = spawnSync(binary, ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== TRUFFLEHOG_VERSION) {
  throw new Error(`expected ${TRUFFLEHOG_VERSION}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'ddn-trufflehog-gate-'));
try {
  const positivePath = join(scratch, 'positive.txt');
  const negativePath = join(scratch, 'negative.txt');
  const syntheticProjectId = Array.from({ length: 32 }, (_, index) => (index % 16).toString(16)).join('');
  const syntheticInfura = ['https://mainnet.infura.io/v3/', syntheticProjectId].join('');
  writeFileSync(positivePath, `rpc = "${syntheticInfura}"\n`, { mode: 0o600 });
  writeFileSync(negativePath, 'rpc = "synthetic-placeholder-not-a-secret"\n', { mode: 0o600 });
  const positive = runScan(binary, positivePath);
  assert.equal(positive.length, 1, 'positive canary must yield exactly one finding');
  assert.equal(positive[0].DetectorName, 'Infura', 'positive canary must exercise the Infura detector');
  assert.equal(runScan(binary, negativePath).length, 0, 'negative canary must yield no findings');
  console.log(`${TRUFFLEHOG_VERSION} integrity and canaries: PASS`);

  const findings = runScan(binary, source).map((finding) => {
    const metadata = finding.SourceMetadata?.Data?.Filesystem;
    if (!metadata?.file || !Number.isInteger(metadata.line)) throw new Error('trufflehog finding lacks filesystem metadata');
    const path = normalized(relative(source, resolve(metadata.file)));
    if (path === '..' || path.startsWith('../')) throw new Error('trufflehog finding is outside snapshot');
    const raw = finding.Raw || finding.RawV2;
    if (typeof raw !== 'string' || raw.length === 0) throw new Error('trufflehog finding lacks raw fingerprint material');
    const fingerprintSha256 = createHash('sha256').update(raw).digest('hex');
    return { detector: finding.DetectorName, path, line: metadata.line, fingerprintSha256 };
  });
  const manifest = JSON.parse(readFileSync(join(source, 'public-snapshot-manifest.json'), 'utf8'));
  const expected = (manifest.secretScannerExceptions ?? [])
    .filter((entry) => entry.scanner === 'trufflehog')
    .map((entry) => ({
      detector: entry.detector,
      path: entry.path,
      line: entry.line,
      fingerprintSha256: entry.fingerprintSha256,
    }));
  const expectedKeys = new Set(expected.map(findingKey));
  const actualKeys = new Set(findings.map(findingKey));
  const unexpected = findings.filter((finding) => !expectedKeys.has(findingKey(finding)));
  const stale = expected.filter((finding) => !actualKeys.has(findingKey(finding)));
  for (const finding of unexpected) {
    console.error(`${finding.path}:${finding.line}: unexpected trufflehog/${finding.detector} finding (value redacted)`);
  }
  for (const finding of stale) {
    console.error(`${finding.path}:${finding.line}: stale trufflehog/${finding.detector} exception`);
  }
  if (unexpected.length > 0 || stale.length > 0 || findings.length !== actualKeys.size) {
    throw new Error('trufflehog snapshot exception comparison failed');
  }
  console.log(`trufflehog snapshot gate: PASS (${findings.length} exact redacted finding(s))`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

export { TRUFFLEHOG_DARWIN_ARM64_ARCHIVE_SHA256 };
