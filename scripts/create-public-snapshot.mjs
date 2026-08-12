#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  collectGitPublicFiles,
  isAllowedPath,
  isWithin,
  renderSha256Manifest,
  safeRelativePath,
  validateManifestPaths,
  walkSnapshotFiles,
} from './public-snapshot-files.mjs';

const root = process.cwd();
const { values } = parseArgs({
  options: {
    'source-sha': { type: 'string' },
    destination: { type: 'string' },
    'sha256-manifest': { type: 'string' },
    execute: { type: 'boolean', default: false },
    'worktree-audit': { type: 'boolean', default: false },
  },
});
if (!values['source-sha'] || !values.destination) {
  throw new Error(
    'usage: create-public-snapshot --source-sha <full SHA> --destination <empty path> [--sha256-manifest <outside path>] [--worktree-audit] [--execute]'
  );
}
if (!/^[0-9a-f]{40}$/.test(values['source-sha'])) throw new Error('--source-sha must be a full 40-character commit SHA');
const resolvedSha = execFileSync('git', ['rev-parse', `${values['source-sha']}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
if (resolvedSha !== values['source-sha']) throw new Error('source SHA did not resolve exactly');
const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (status && !values['worktree-audit']) throw new Error('source worktree must be clean before snapshot validation');

const manifest = JSON.parse(
  values['worktree-audit']
    ? readFileSync(resolve(root, 'public-snapshot-manifest.json'), 'utf8')
    : execFileSync('git', ['show', `${resolvedSha}:public-snapshot-manifest.json`], { cwd: root, encoding: 'utf8' })
);
validateManifestPaths(manifest);
for (const source of manifest.vendoredSources ?? []) {
  if (!isAllowedPath(source.path, manifest)) throw new Error(`vendored source is outside the allowlist: ${source.path}`);
  if (!/^[0-9a-f]{40}$/.test(source.commit)) throw new Error(`vendored source commit is not a full SHA: ${source.path}`);
  const treeLine = execFileSync('git', ['ls-tree', resolvedSha, '--', source.path], { cwd: root, encoding: 'utf8' }).trim();
  const match = treeLine.match(/^160000 commit ([0-9a-f]{40})\t/);
  if (!match || match[1] !== source.commit) throw new Error(`vendored source gitlink mismatch: ${source.path}`);
  const configuredUrl = execFileSync('git', ['config', '-f', '.gitmodules', '--get', `submodule.${source.path}.url`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (configuredUrl !== source.sourceUrl) throw new Error(`vendored source URL mismatch: ${source.path}`);
  const localCommit = execFileSync('git', ['-C', source.path, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (localCommit !== source.commit) throw new Error(`vendored source checkout mismatch: ${source.path}`);
}
const files = values['worktree-audit']
  ? collectGitPublicFiles(root, manifest)
  : execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', resolvedSha], { cwd: root })
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .filter((path) => isAllowedPath(path, manifest));
const rootFiles = files.filter(
  (path) => !(manifest.vendoredSources ?? []).some((source) => isWithin(path, source.path))
);
if (rootFiles.length === 0) throw new Error('manifest selected no files');
if (rootFiles.some((path) => path === '.git' || path.startsWith('.git/') || manifest.excludedPaths.some((excluded) => path === excluded || path.startsWith(`${excluded}/`)))) {
  throw new Error('snapshot selection contains an excluded path');
}
const vendoredFiles = (manifest.vendoredSources ?? []).flatMap((source) =>
  execFileSync('git', ['-C', source.path, 'ls-tree', '-r', '--name-only', '-z', source.commit], { cwd: root })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((path) => safeRelativePath(`${source.path}/${path}`))
    .filter((path) => isAllowedPath(path, manifest))
);
const expectedFiles = [...new Set([...rootFiles, ...vendoredFiles])].sort();
for (const path of expectedFiles) {
  if (!isAllowedPath(path, manifest)) throw new Error(`snapshot selection contains a file outside the allowlist: ${path}`);
}

const destination = resolve(values.destination);
const sha256Manifest = resolve(values['sha256-manifest'] ?? `${destination}.sha256`);
const manifestRelativeToDestination = relative(destination, sha256Manifest);
if (!manifestRelativeToDestination.startsWith('..') && !isAbsolute(manifestRelativeToDestination)) {
  throw new Error('SHA-256 manifest must be outside the history-free snapshot directory');
}

console.log(
  `snapshot dry-run: source=${resolvedSha} mode=${values['worktree-audit'] ? 'worktree-audit' : 'committed'} files=${expectedFiles.length} destination=${destination} sha256-manifest=${sha256Manifest}`
);
if (!values.execute) {
  console.log('snapshot dry-run: PASS (no files copied; pass --execute only after a separate authorization)');
  process.exit(0);
}

if (existsSync(destination)) throw new Error('destination already exists; refusing to overwrite');
if (existsSync(sha256Manifest)) throw new Error('SHA-256 manifest already exists; refusing to overwrite');
mkdirSync(destination, { recursive: true, mode: 0o700 });
if (values['worktree-audit']) {
  for (const path of rootFiles) {
    const source = resolve(root, path);
    const target = resolve(destination, path);
    if (!source.startsWith(`${resolve(root)}/`) || !target.startsWith(`${destination}/`)) {
      throw new Error(`unsafe snapshot path: ${path}`);
    }
    mkdirSync(resolve(target, '..'), { recursive: true, mode: 0o755 });
    copyFileSync(source, target);
    chmodSync(target, statSync(source).mode & 0o777);
  }
} else {
  const archive = spawnSync('git', ['archive', '--format=tar', resolvedSha, ...rootFiles], { cwd: root, maxBuffer: 1024 * 1024 * 128 });
  if (archive.status !== 0) throw new Error('git archive failed');
  const extract = spawnSync('tar', ['-x', '-C', destination], { input: archive.stdout, maxBuffer: 1024 * 1024 * 128 });
  if (extract.status !== 0) throw new Error('tar extraction failed');
}
for (const source of manifest.vendoredSources ?? []) {
  const vendoredDestination = resolve(destination, source.path);
  mkdirSync(vendoredDestination, { recursive: true, mode: 0o755 });
  const vendoredRelativeFiles = vendoredFiles
    .filter((path) => isWithin(path, source.path))
    .map((path) => path.slice(source.path.length + 1));
  if (vendoredRelativeFiles.length === 0) throw new Error(`vendored source selected no files: ${source.path}`);
  const vendoredArchive = spawnSync('git', ['-C', source.path, 'archive', '--format=tar', source.commit, ...vendoredRelativeFiles], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 128,
  });
  if (vendoredArchive.status !== 0) throw new Error(`vendored source archive failed: ${source.path}`);
  const vendoredExtract = spawnSync('tar', ['-x', '-C', vendoredDestination], {
    input: vendoredArchive.stdout,
    maxBuffer: 1024 * 1024 * 128,
  });
  if (vendoredExtract.status !== 0) throw new Error(`vendored source extraction failed: ${source.path}`);
}
const actualFiles = walkSnapshotFiles(destination);
const actualSet = new Set(actualFiles);
const expectedSet = new Set(expectedFiles);
for (const path of expectedFiles) {
  if (!actualSet.has(path)) throw new Error(`snapshot copy is missing an expected file: ${path}`);
}
for (const path of actualFiles) {
  if (!expectedSet.has(path)) throw new Error(`snapshot copy contains an unexpected file: ${path}`);
}
writeFileSync(sha256Manifest, renderSha256Manifest(destination, actualFiles), { mode: 0o600, flag: 'wx' });
console.log(`snapshot copy complete; no Git repository was initialized; SHA-256 manifest=${sha256Manifest}`);
