#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  collectGitPublicFiles,
  collectSnapshotPublicFiles,
  isAllowedPath,
  isWithin,
} from './public-snapshot-files.mjs';

export function unsafeTextCategories(line) {
  const categories = [];
  if (/\/Users\/[^/\s]+\//.test(line) || /[A-Za-z]:\\Users\\[^\\\s]+\\/.test(line)) categories.push('user-specific-absolute-path');
  if (/https?:\/\/[^/\s]*(?:\.internal|\.local)(?:[/:\s]|$)/i.test(line)) categories.push('private-url-form');
  if (/github\.com\/[^/\s]+\/ddn(?:[/#?]|$)/i.test(line)) categories.push('private-source-repository-url');
  const forbiddenWordDigests = new Map([
    ['82f54434e927e9467df64f92c8b90734f16b9370359af2e9d47f9bb3b878e2e5', 'private-product-brand'],
    ['66cd9688a2ae068244ea01e70f0e230f5623b7fa4cdecb65070a09ec06452262', 'excluded-surface-reference'],
  ]);
  for (const word of line.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const normalizedWord = word.toLocaleLowerCase('en-US');
    for (let start = 0; start <= normalizedWord.length - 9; start += 1) {
      const digest = createHash('sha256').update(normalizedWord.slice(start, start + 9)).digest('hex');
      const category = forbiddenWordDigests.get(digest);
      if (category && !categories.includes(category)) categories.push(category);
    }
  }
  if (/§\s*\d/.test(line)) categories.push('private-build-plan-section-reference');
  if (/\btask\s*#\d+\b/i.test(line)) categories.push('private-build-task-reference');
  if (/(?:privateKey(?:SeedHex)?|private_key|[A-Z][A-Z0-9_]*PRIVATE_KEY)\s*(?::[^=,\n]+)?[:=]\s*['"](?:0x)?[0-9a-f]{64}['"]/i.test(line)) {
    categories.push('fixed-private-key');
  }
  if (/(?:TOKEN|PASSWORD|SESSION_SECRET)\s*[:=]\s*['"][A-Za-z0-9_-]{24,}['"]/.test(line)) categories.push('fixed-credential');
  return categories;
}

function selfTest() {
  const manifest = {
    allowedRoots: ['apps/reference', 'docs'],
    allowedRootFiles: ['README.md'],
    excludedPaths: ['docs/private.md'],
  };
  assert.equal(isAllowedPath('apps/reference/src/a.ts', manifest), true);
  assert.equal(isAllowedPath('apps/private/src/a.ts', manifest), false);
  assert.equal(isAllowedPath('docs/private.md', manifest), false);
  assert.deepEqual(unsafeTextCategories('/Users/example/project'), ['user-specific-absolute-path']);
  assert.deepEqual(unsafeTextCategories('https://service.internal/path'), ['private-url-form']);
  const privateBrandCanary = String.fromCodePoint(107, 111, 112, 105, 108, 111, 116, 116, 105);
  assert.deepEqual(unsafeTextCategories(`private product: ${privateBrandCanary}`), ['private-product-brand']);
  const excludedSurfaceCanary = String.fromCodePoint(100, 97, 115, 104, 98, 111, 97, 114, 100);
  assert.deepEqual(unsafeTextCategories(`excluded surface: ${excludedSurfaceCanary}`), ['excluded-surface-reference']);
  assert.deepEqual(unsafeTextCategories('internal section §12.1'), ['private-build-plan-section-reference']);
  assert.deepEqual(unsafeTextCategories('internal task #58'), ['private-build-task-reference']);
  assert.deepEqual(unsafeTextCategories('ordinary public text'), []);
  console.log('public-release-check self-test: PASS');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    'snapshot-manifest': { type: 'string' },
  },
});
if (!['git-worktree', 'snapshot'].includes(values.mode)) {
  throw new Error('usage: public-release-check --mode <git-worktree|snapshot> [--snapshot-manifest <SHA-256 manifest>]');
}
if (values.mode === 'snapshot' && !values['snapshot-manifest']) {
  throw new Error('snapshot mode requires --snapshot-manifest');
}

const root = process.cwd();

const manifestPath = resolve(root, 'public-snapshot-manifest.json');
if (!existsSync(manifestPath)) throw new Error('public snapshot manifest is missing');
const manifestStats = lstatSync(manifestPath);
if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
  throw new Error('public snapshot manifest must be a regular file');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const publicFiles = values.mode === 'git-worktree'
  ? collectGitPublicFiles(root, manifest)
  : collectSnapshotPublicFiles(root, manifest, resolve(values['snapshot-manifest']));
const failures = [];

function fail(path, category, line) {
  failures.push({ path, category, line });
}

if (!manifest.allowedRootFiles.includes('eslint.config.js')) {
  fail('public-snapshot-manifest.json', 'eslint-config-not-allowlisted');
}
if (!manifest.allowedRootFiles.includes('public-snapshot-manifest.json')) {
  fail('public-snapshot-manifest.json', 'snapshot-manifest-not-self-allowlisted');
}
for (const overlyBroadRoot of ['docs', 'apps/explorer']) {
  if (manifest.allowedRoots.includes(overlyBroadRoot)) {
    fail('public-snapshot-manifest.json', 'overly-broad-public-root');
  }
}

const scannerExceptionKeys = new Set();
for (const exception of manifest.secretScannerExceptions ?? []) {
  const key = [exception.scanner, exception.detector ?? exception.rule, exception.path, exception.line ?? '', exception.vendoredSourceCommit ?? ''].join('\0');
  if (scannerExceptionKeys.has(key)) fail(exception.path, 'duplicate-secret-scanner-exception');
  scannerExceptionKeys.add(key);
  if (!['trufflehog', 'gitleaks'].includes(exception.scanner)) {
    fail(exception.path ?? 'public-snapshot-manifest.json', 'invalid-secret-scanner-exception-identity');
  }
  if (
    exception.scanner === 'trufflehog' &&
    (!exception.detector || !Number.isInteger(exception.line) || !/^[0-9a-f]{64}$/.test(exception.fingerprintSha256 ?? '') ||
      exception.classification !== 'upstream-test-vector')
  ) {
    fail(exception.path ?? 'public-snapshot-manifest.json', 'invalid-secret-scanner-exception-classification');
  }
  if (
    exception.scanner === 'gitleaks' &&
    (!exception.rule || !Number.isInteger(exception.line) || !Number.isInteger(exception.count) || exception.count < 1 ||
      exception.classification !== 'deterministic-public-test-fixture')
  ) {
    fail(exception.path ?? 'public-snapshot-manifest.json', 'invalid-gitleaks-exception');
  }
  if (exception.scanner === 'gitleaks') {
    if (!isAllowedPath(exception.path, manifest) || !existsSync(resolve(root, exception.path))) {
      fail(exception.path, 'secret-scanner-exception-path-missing-or-not-public');
    }
    continue;
  }
  const vendoredSource = (manifest.vendoredSources ?? []).find((source) => isWithin(exception.path ?? '', source.path));
  if (!vendoredSource || vendoredSource.commit !== exception.vendoredSourceCommit) {
    fail(exception.path ?? 'public-snapshot-manifest.json', 'secret-scanner-exception-not-bound-to-vendored-commit');
    continue;
  }
  if (!isAllowedPath(exception.path, manifest) || !existsSync(resolve(root, exception.path))) {
    fail(exception.path, 'secret-scanner-exception-path-missing-or-not-public');
  }
}

for (const required of ['LICENSE', 'NOTICE', 'SECURITY.md']) {
  if (!existsSync(resolve(root, required))) fail(required, 'required-release-file-missing');
}
if (existsSync(resolve(root, 'LICENSE'))) {
  const license = readFileSync(resolve(root, 'LICENSE'), 'utf8');
  if (!/Apache License\s+Version 2\.0, January 2004/.test(license)) fail('LICENSE', 'apache-2.0-text-not-recognized');
}
if (existsSync(resolve(root, 'NOTICE'))) {
  const notice = readFileSync(resolve(root, 'NOTICE'), 'utf8');
  if (!notice.includes('Copyright 2026 Mikko Tarkiainen')) fail('NOTICE', 'approved-copyright-notice-missing');
  if (!notice.includes('forge-std')) fail('NOTICE', 'vendored-attribution-missing');
}
if (existsSync(resolve(root, 'SECURITY.md'))) {
  const security = readFileSync(resolve(root, 'SECURITY.md'), 'utf8');
  if (/contact details to be added|placeholder|PENDING MAINTAINER APPROVAL/i.test(security)) {
    fail('SECURITY.md', 'security-contact-placeholder');
  }
  if (!/GitHub Private Vulnerability\s+Reporting/i.test(security)) fail('SECURITY.md', 'private-vulnerability-reporting-channel-missing');
  if (!/reasonable time/i.test(security)) fail('SECURITY.md', 'nonbinding-acknowledgement-language-missing');
  if (!/do not (?:open|use).*public.*issue/i.test(security)) fail('SECURITY.md', 'public-issue-warning-missing');
}
if (existsSync(resolve(root, 'Cargo.toml'))) {
  const cargo = readFileSync(resolve(root, 'Cargo.toml'), 'utf8');
  if (!/^license\s*=\s*"Apache-2\.0"/m.test(cargo)) fail('Cargo.toml', 'workspace-apache-license-metadata-missing');
}

for (const path of publicFiles) {
  if (unsafeTextCategories(path).some((category) => ['private-product-brand', 'excluded-surface-reference'].includes(category))) {
    fail(path, 'forbidden-public-path');
  }
  if (/(^|\/)(?:node_modules|target|dist|out|\.next|coverage|playwright-report|test-results|\.turbo)(\/|$)/.test(path)) {
    fail(path, 'generated-or-build-artifact');
  }
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) continue;
  const stats = statSync(absolute);
  if (!stats.isFile()) continue;
  if (stats.size > 1_000_000) fail(path, 'large-file-over-1mb');
  if (stats.size > 2_000_000) continue;
  const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.wasm', '.bin']);
  if (binaryExtensions.has(extname(path).toLowerCase())) continue;
  if (
    (/\.(?:ts|tsx|js|mjs|rs|sol|sh|ya?ml)$/.test(path) || path.endsWith('.Dockerfile')) &&
    !path.endsWith('/next-env.d.ts') &&
    !path.startsWith('contracts/lib/forge-std/')
  ) {
    const header = readFileSync(absolute, 'utf8').slice(0, 512);
    if (!/SPDX-License-Identifier: Apache-2\.0/.test(header)) fail(path, 'apache-spdx-header-missing');
  }
  if (/\.ya?ml$/.test(path)) {
    const firstNonempty = readFileSync(absolute, 'utf8').split(/\r?\n/).find((line) => line.trim().length > 0);
    if (firstNonempty?.startsWith('//')) fail(path, 'invalid-yaml-comment-syntax');
  }
  if (path.endsWith('package.json') && !path.startsWith('contracts/lib/forge-std/')) {
    const packageMetadata = JSON.parse(readFileSync(absolute, 'utf8'));
    if (packageMetadata.license !== 'Apache-2.0') fail(path, 'package-apache-license-metadata-missing');
  }
  if (path === 'scripts/public-release-check.mjs') continue;
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const category of unsafeTextCategories(lines[index])) {
      if (category === 'private-build-plan-section-reference' && extname(path).toLowerCase() !== '.md') continue;
      const excepted =
        category.startsWith('fixed-') &&
        manifest.exactTestCredentialExceptions.some((allowed) => isWithin(path, allowed));
      if (!excepted) fail(path, category, index + 1);
    }
  }
}

for (const licensePath of ['contracts/lib/forge-std/LICENSE-APACHE', 'contracts/lib/forge-std/LICENSE-MIT']) {
  if (!existsSync(resolve(root, licensePath))) fail(licensePath, 'vendored-license-file-missing');
}

for (const exception of manifest.exactTestCredentialExceptions) {
  const absolute = resolve(root, exception);
  if (!existsSync(absolute)) {
    fail(exception, 'declared-test-credential-exception-missing');
    continue;
  }
  if (statSync(absolute).isFile()) {
    const marker = readFileSync(absolute, 'utf8').slice(0, 512);
    if (!/TEST-ONLY \/ NEVER USE IN PRODUCTION/.test(marker)) fail(exception, 'test-credential-marker-missing');
  }
}

const workflowFiles = publicFiles.filter((path) => path.startsWith('.github/workflows/') && /ya?ml$/.test(path));
for (const path of workflowFiles) {
  const lines = readFileSync(resolve(root, path), 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/\buses:\s+[^\s]+@/.test(lines[index]) && !/@[0-9a-f]{40}(?:\s+#\s+\S+)?\s*$/.test(lines[index])) {
      fail(path, 'github-action-not-full-sha-pinned', index + 1);
    }
  }
}

const normalImports = publicFiles.filter(
  (path) => /\.(?:ts|tsx|js|mjs)$/.test(path) && !path.includes('/test-fixtures/') && path !== 'scripts/public-release-check.mjs'
);
for (const path of normalImports) {
  const lines = readFileSync(resolve(root, path), 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('test-fixtures/')) continue;
    const approvedCaller =
      path.endsWith('.test.ts') ||
      path.endsWith('generate-trusted-demo-profile.ts') ||
      path === 'apps/coordinator/src/cli.ts';
    if (!approvedCaller) fail(path, 'test-credential-imported-by-runtime', index + 1);
  }
}

if (failures.length > 0) {
  for (const item of failures) {
    console.error(`${item.path}${item.line ? `:${item.line}` : ''}: ${item.category}`);
  }
  console.error(`public-release-check: FAIL (${failures.length} finding(s); values intentionally redacted)`);
  process.exit(1);
}

console.log(`public-release-check: PASS (${publicFiles.length} allowlisted files; mode=${values.mode})`);
