#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';

const GITLEAKS_VERSION = '8.18.4';
const GITLEAKS_DARWIN_ARM64_ARCHIVE_SHA256 = 'a480d8593acd8215b22402cf0f3f88b01dcd3610c63b5391db640f7767e62104';
const GITLEAKS_DARWIN_ARM64_BINARY_SHA256 = 'a86787a498e702f8820fc73c219ca44ecdf1f415eed8daf922888ffd6c4cf680';
const LEAK_EXIT_CODE = 97;

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalized(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function findingKey(finding) {
  return `${finding.rule}\0${finding.path}\0${finding.line}`;
}

function grouped(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    const current = groups.get(key) ?? { ...finding, count: 0 };
    current.count += finding.count ?? 1;
    groups.set(key, current);
  }
  return [...groups.values()];
}

function runScan(binary, source, reportPath) {
  const result = spawnSync(
    binary,
    [
      'detect',
      '--no-git',
      '--source',
      source,
      '--redact',
      '--no-banner',
      '--exit-code',
      String(LEAK_EXIT_CODE),
      '--report-format',
      'json',
      '--report-path',
      reportPath,
    ],
    { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } }
  );
  if (result.error) throw result.error;
  if (![0, LEAK_EXIT_CODE].includes(result.status)) {
    throw new Error(`gitleaks execution failed with status ${result.status}; output intentionally suppressed`);
  }
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : [];
  assert.equal(Array.isArray(report), true, 'gitleaks report must be a JSON array');
  for (const finding of report) {
    assert.equal(finding.Secret, 'REDACTED', 'gitleaks emitted a non-redacted secret');
  }
  assert.equal(result.status, report.length > 0 ? LEAK_EXIT_CODE : 0, 'gitleaks status/report mismatch');
  return report;
}

const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    source: { type: 'string' },
  },
});
if (!values.binary || !values.source) {
  throw new Error('usage: gitleaks-gate --binary <verified gitleaks binary> --source <history-free snapshot>');
}

const binary = resolve(values.binary);
const source = resolve(values.source);
if (!existsSync(binary)) throw new Error('gitleaks binary does not exist');
if (!existsSync(join(source, 'public-snapshot-manifest.json'))) throw new Error('snapshot manifest is missing from source');
if (existsSync(join(source, '.git'))) throw new Error('source must be a history-free snapshot, not a Git worktree');
if (sha256(binary) !== GITLEAKS_DARWIN_ARM64_BINARY_SHA256) {
  throw new Error('gitleaks binary SHA-256 mismatch');
}
const version = spawnSync(binary, ['version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== GITLEAKS_VERSION) {
  throw new Error(`expected gitleaks ${GITLEAKS_VERSION}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'ddn-gitleaks-gate-'));
try {
  const positivePath = join(scratch, 'positive.txt');
  const negativePath = join(scratch, 'negative.txt');
  writeFileSync(positivePath, `token = "${['ghp_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('')}"\n`, { mode: 0o600 });
  writeFileSync(negativePath, 'token = "synthetic-placeholder-not-a-secret"\n', { mode: 0o600 });

  const positive = runScan(binary, positivePath, join(scratch, 'positive.json'));
  assert.equal(positive.length, 1, 'positive canary must yield exactly one finding');
  assert.equal(positive[0].RuleID, 'github-pat', 'positive canary must exercise the github-pat rule');
  const negative = runScan(binary, negativePath, join(scratch, 'negative.json'));
  assert.equal(negative.length, 0, 'negative canary must yield no findings');
  console.log(`gitleaks ${GITLEAKS_VERSION} integrity and canaries: PASS`);

  const rawFindings = runScan(binary, source, join(scratch, 'snapshot.json'));
  const sourceName = basename(source);
  const findings = grouped(rawFindings.map((finding) => {
    let path = normalized(finding.File);
    if (path.startsWith(`${sourceName}/`)) path = path.slice(sourceName.length + 1);
    if (resolve(path) === path) path = normalized(relative(source, path));
    return { scanner: 'gitleaks', rule: finding.RuleID, path, line: finding.StartLine };
  }));
  const manifest = JSON.parse(readFileSync(join(source, 'public-snapshot-manifest.json'), 'utf8'));
  const expected = (manifest.secretScannerExceptions ?? [])
    .filter((entry) => entry.scanner === 'gitleaks')
    .map((entry) => ({ scanner: entry.scanner, rule: entry.rule, path: entry.path, line: entry.line, count: entry.count }));
  const expectedKeys = new Map(expected.map((finding) => [findingKey(finding), finding]));
  const actualKeys = new Map(findings.map((finding) => [findingKey(finding), finding]));

  const unexpected = findings.filter((finding) => expectedKeys.get(findingKey(finding))?.count !== finding.count);
  const stale = expected.filter((finding) => actualKeys.get(findingKey(finding))?.count !== finding.count);
  for (const finding of unexpected) {
    console.error(`${finding.path}:${finding.line}: unexpected gitleaks/${finding.rule} finding (value redacted)`);
  }
  for (const finding of stale) {
    console.error(`${finding.path}:${finding.line}: stale gitleaks/${finding.rule} exception`);
  }
  if (unexpected.length > 0 || stale.length > 0) {
    throw new Error('gitleaks snapshot exception comparison failed');
  }
  console.log(`gitleaks snapshot gate: PASS (${rawFindings.length} exact redacted finding(s) in ${findings.length} location(s))`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

export { GITLEAKS_DARWIN_ARM64_ARCHIVE_SHA256 };
