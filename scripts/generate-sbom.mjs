#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  options: {
    'source-sha': { type: 'string' },
    'worktree-audit': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});
const positional = positionals.filter((arg) => arg !== '--');
if (positional.length !== 1) {
  throw new Error('usage: generate-sbom.mjs [--source-sha <full SHA>] [--worktree-audit] [--] <output.cdx.json>');
}
const [output] = positional;
const root = process.cwd();
const components = new Map();
const hasGitMetadata = existsSync(resolve(root, '.git'));

if (values['source-sha'] !== undefined && !/^[0-9a-f]{40}$/.test(values['source-sha'])) {
  throw new Error('--source-sha must be a full 40-character commit SHA');
}
if (!hasGitMetadata && !values['source-sha']) {
  throw new Error('history-free snapshot requires an explicit --source-sha');
}

function addComponent(component) {
  if (!components.has(component['bom-ref'])) components.set(component['bom-ref'], component);
}

function npmPurl(name, version) {
  return `pkg:npm/${name.startsWith('@') ? name.replace('/', '%2F') : name}@${version}`;
}

function visitNpm(name, value) {
  let version = value?.version;
  if (typeof version !== 'string') return;
  if (version.startsWith('link:') && value.path) {
    try {
      const localPackage = JSON.parse(readFileSync(resolve(value.path, 'package.json'), 'utf8'));
      version = localPackage.version;
    } catch {
      return;
    }
  }
  if (!version || !name) return;
  const purl = npmPurl(name, version);
  addComponent({ type: 'library', name, version, purl, 'bom-ref': purl });
  for (const [childName, child] of Object.entries(value.dependencies ?? {})) visitNpm(childName, child);
}

const npmProjects = JSON.parse(execFileSync('pnpm', ['list', '-r', '--json', '--depth', 'Infinity'], { cwd: root, maxBuffer: 128 * 1024 * 1024 }));
for (const project of npmProjects) {
  if (project.name && project.version) {
    const purl = npmPurl(project.name, project.version);
    addComponent({ type: 'application', name: project.name, version: project.version, purl, 'bom-ref': purl, scope: 'required' });
  }
  for (const [name, dependency] of Object.entries(project.dependencies ?? {})) visitNpm(name, dependency);
  for (const [name, dependency] of Object.entries(project.devDependencies ?? {})) visitNpm(name, dependency);
}

const cargoLock = readFileSync(resolve(root, 'Cargo.lock'), 'utf8');
for (const block of cargoLock.split(/\n\[\[package\]\]\n/).slice(1)) {
  const name = block.match(/^name = "([^"]+)"/m)?.[1];
  const version = block.match(/^version = "([^"]+)"/m)?.[1];
  if (!name || !version) continue;
  const purl = `pkg:cargo/${encodeURIComponent(name)}@${version}`;
  const component = { type: 'library', name, version, purl, 'bom-ref': purl };
  const checksum = block.match(/^checksum = "([0-9a-f]{64})"/m)?.[1];
  if (checksum) component.hashes = [{ alg: 'SHA-256', content: checksum }];
  addComponent(component);
}

const publicManifestPath = resolve(root, 'public-snapshot-manifest.json');
const publicManifest = existsSync(publicManifestPath) ? JSON.parse(readFileSync(publicManifestPath, 'utf8')) : undefined;
let forgeCommit = publicManifest?.vendoredSources?.find((source) => source.path === 'contracts/lib/forge-std')?.commit;
if (!forgeCommit && hasGitMetadata) {
  forgeCommit = execFileSync('git', ['submodule', 'status', '--', 'contracts/lib/forge-std'], { cwd: root, encoding: 'utf8' })
    .trim()
    .replace(/^[-+ ]?([0-9a-f]{40}).*$/, '$1');
}
if (!/^[0-9a-f]{40}$/.test(forgeCommit ?? '')) throw new Error('could not resolve pinned forge-std commit');
const forgePurl = `pkg:github/foundry-rs/forge-std@${forgeCommit}`;
addComponent({ type: 'library', name: 'forge-std', version: forgeCommit, purl: forgePurl, 'bom-ref': forgePurl });

const sourceSha = values['source-sha'] ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const worktreeDirty = values['worktree-audit'] || (hasGitMetadata && execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).length > 0);
const lockHash = createHash('sha256').update(readFileSync(resolve(root, 'pnpm-lock.yaml'))).update(cargoLock).digest('hex');
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      name: 'ddn-reference-source',
      version: worktreeDirty ? `0.0.0-worktree-audit+${sourceSha.slice(0, 12)}` : sourceSha,
    },
    properties: [
      { name: 'ddn:source-commit', value: sourceSha },
      { name: 'ddn:worktree-dirty', value: String(worktreeDirty) },
      { name: 'ddn:combined-lockfile-sha256', value: lockHash },
    ],
  },
  components: [...components.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
};
writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`, { mode: 0o600 });
console.log(`CycloneDX SBOM: components=${bom.components.length} output=${output}`);
