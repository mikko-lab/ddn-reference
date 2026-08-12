#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

export function normalized(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

export function safeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('snapshot path must be a non-empty string');
  if (path.includes('\\') || /[\0\r\n]/.test(path)) throw new Error(`unsafe snapshot path encoding: ${JSON.stringify(path)}`);
  if (isAbsolute(path) || posix.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    throw new Error(`snapshot path must be relative: ${path}`);
  }
  const parts = path.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..') || posix.normalize(path) !== path) {
    throw new Error(`unsafe snapshot path traversal: ${path}`);
  }
  return path;
}

export function isWithin(path, base) {
  return path === base || path.startsWith(`${base}/`);
}

export function isAllowedPath(path, manifest) {
  const candidate = safeRelativePath(normalized(path));
  if (manifest.excludedPaths.some((excluded) => isWithin(candidate, excluded))) return false;
  return manifest.allowedRootFiles.includes(candidate) || manifest.allowedRoots.some((allowed) => isWithin(candidate, allowed));
}

export function validateManifestPaths(manifest) {
  for (const field of ['allowedRoots', 'allowedRootFiles', 'excludedPaths']) {
    if (!Array.isArray(manifest[field])) throw new Error(`manifest ${field} must be an array`);
    const seen = new Set();
    for (const path of manifest[field]) {
      const safe = safeRelativePath(path);
      if (seen.has(safe)) throw new Error(`manifest ${field} contains a duplicate path: ${safe}`);
      seen.add(safe);
    }
  }
  for (const source of manifest.vendoredSources ?? []) safeRelativePath(source.path);
}

function gitPaths(root, args) {
  return execFileSync('git', args, { cwd: root })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((path) => safeRelativePath(normalized(path)));
}

export function collectGitPublicFiles(root, manifest) {
  validateManifestPaths(manifest);
  const rootListed = gitPaths(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const vendoredFiles = (manifest.vendoredSources ?? []).flatMap((source) =>
    gitPaths(resolve(root, source.path), ['ls-files', '-z']).map((path) => safeRelativePath(`${source.path}/${path}`))
  );
  const selected = [...new Set([...rootListed, ...vendoredFiles].filter((path) => isAllowedPath(path, manifest)))].sort();
  const files = [];
  for (const path of selected) {
    const absolute = resolve(root, path);
    const relativeToRoot = normalized(relative(root, absolute));
    if (relativeToRoot !== path || relativeToRoot === '..' || relativeToRoot.startsWith('../')) {
      throw new Error(`Git path escapes source root: ${path}`);
    }
    if (!existsSync(absolute)) throw new Error(`Git-listed public file is missing: ${path}`);
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) throw new Error(`public symlink is forbidden: ${path}`);
    if (stats.isDirectory() && (manifest.vendoredSources ?? []).some((source) => source.path === path)) continue;
    if (!stats.isFile()) throw new Error(`public path is not a regular file: ${path}`);
    files.push(path);
  }
  return files;
}

export function walkSnapshotFiles(root) {
  const files = [];
  function visit(relativeDirectory) {
    const directory = relativeDirectory ? resolve(root, relativeDirectory) : root;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = safeRelativePath(relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name);
      const absolute = resolve(root, path);
      const relativeToRoot = normalized(relative(root, absolute));
      if (relativeToRoot !== path || relativeToRoot === '..' || relativeToRoot.startsWith('../')) {
        throw new Error(`snapshot path escapes source root: ${path}`);
      }
      const stats = lstatSync(absolute);
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) throw new Error(`snapshot symlink is forbidden: ${path}`);
      if (entry.isDirectory() && stats.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && stats.isFile()) {
        files.push(path);
      } else {
        throw new Error(`snapshot path is not a regular file or directory: ${path}`);
      }
    }
  }
  visit('');
  return files.sort();
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function renderSha256Manifest(root, files) {
  return [...files]
    .sort()
    .map((path) => `${sha256File(resolve(root, safeRelativePath(path)))}  ${path}`)
    .join('\n') + '\n';
}

export function parseSha256Manifest(manifestPath) {
  if (!existsSync(manifestPath)) throw new Error('snapshot SHA-256 manifest is missing');
  const stats = lstatSync(manifestPath);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('snapshot SHA-256 manifest must be a regular file');
  const entries = new Map();
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0) throw new Error('snapshot SHA-256 manifest is empty');
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error('snapshot SHA-256 manifest contains an invalid line');
    const path = safeRelativePath(match[2]);
    if (entries.has(path)) throw new Error(`snapshot SHA-256 manifest contains a duplicate path: ${path}`);
    entries.set(path, match[1]);
  }
  return entries;
}

export function collectSnapshotPublicFiles(root, manifest, sha256ManifestPath) {
  validateManifestPaths(manifest);
  if (existsSync(resolve(root, '.git'))) throw new Error('history-free snapshot must not contain .git');
  const actual = walkSnapshotFiles(root);
  for (const path of actual) {
    if (!isAllowedPath(path, manifest)) throw new Error(`snapshot contains a file outside the public allowlist: ${path}`);
  }
  const expected = parseSha256Manifest(sha256ManifestPath);
  for (const path of expected.keys()) {
    if (!isAllowedPath(path, manifest)) throw new Error(`SHA-256 manifest contains a file outside the public allowlist: ${path}`);
  }
  const actualSet = new Set(actual);
  for (const path of expected.keys()) {
    if (!actualSet.has(path)) throw new Error(`snapshot file is missing: ${path}`);
  }
  for (const path of actual) {
    if (!expected.has(path)) throw new Error(`snapshot contains an unmanifested file: ${path}`);
    if (sha256File(resolve(root, path)) !== expected.get(path)) throw new Error(`snapshot SHA-256 mismatch: ${path}`);
  }
  return actual;
}
