#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const positional = process.argv.slice(2).filter((arg) => arg !== '--');
if (positional.length !== 1) throw new Error('usage: dependency-license-report.mjs [--] <output.json>');
const [output] = positional;
const root = process.cwd();

const npmRaw = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], { cwd: root, maxBuffer: 128 * 1024 * 1024 }));
const npm = Object.entries(npmRaw)
  .filter(([, entries]) => Array.isArray(entries))
  .map(([license, entries]) => ({ license, packageCount: entries.length }))
  .sort((a, b) => a.license.localeCompare(b.license));

function cargoPackages(lock) {
  return lock.split(/\n\[\[package\]\]\n/).slice(1).flatMap((block) => {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    const version = block.match(/^version = "([^"]+)"/m)?.[1];
    const source = block.match(/^source = "([^"]+)"/m)?.[1];
    const checksum = block.match(/^checksum = "([0-9a-f]{64})"/m)?.[1];
    return name && version ? [{ name, version, source, checksum }] : [];
  });
}

function licenseFromManifest(path) {
  if (!existsSync(path)) return undefined;
  const packageSection = readFileSync(path, 'utf8').match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|\z)/m)?.[1] ?? '';
  return packageSection.match(/^license\s*=\s*"([^"]+)"/m)?.[1];
}

const registryRoots = [];
const cargoSourceRoot = join(homedir(), '.cargo', 'registry', 'src');
if (existsSync(cargoSourceRoot)) {
  for (const entry of readdirSync(cargoSourceRoot)) registryRoots.push(join(cargoSourceRoot, entry));
}
const workspaceMetadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--no-deps'], { cwd: root }));
const workspaceByKey = new Map(workspaceMetadata.packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
const registryEvidence = JSON.parse(readFileSync(resolve(root, 'dependency-license-evidence.json'), 'utf8'));
const evidenceByKey = new Map(registryEvidence.cargo.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
const usedEvidence = new Set();
const cargo = [];
for (const pkg of cargoPackages(readFileSync(resolve(root, 'Cargo.lock'), 'utf8'))) {
  const key = `${pkg.name}@${pkg.version}`;
  const workspace = workspaceByKey.get(key);
  let license = workspace?.license ?? undefined;
  let evidence = workspace ? 'workspace-metadata' : undefined;
  if (!license) {
    for (const registryRoot of registryRoots) {
      const manifest = join(registryRoot, `${pkg.name}-${pkg.version}`, 'Cargo.toml');
      license = licenseFromManifest(manifest);
      if (license) {
        evidence = 'local-registry-manifest';
        break;
      }
    }
  }
  if (!license) {
    const registryEntry = evidenceByKey.get(key);
    if (registryEntry) {
      if (!pkg.checksum || registryEntry.checksum !== pkg.checksum) {
        throw new Error(`registry license evidence checksum mismatch for ${key}`);
      }
      license = registryEntry.license;
      usedEvidence.add(key);
    }
  }
  const registryBacked = usedEvidence.has(key);
  cargo.push({
    name: pkg.name,
    version: pkg.version,
    license: license ?? 'UNRESOLVED',
    evidence: registryBacked ? 'crates.io-api-checksum-match' : evidence ?? 'missing-local-source',
  });
}
for (const key of evidenceByKey.keys()) {
  if (!usedEvidence.has(key) && !workspaceByKey.has(key)) {
    const inLock = cargo.some((pkg) => `${pkg.name}@${pkg.version}` === key);
    if (!inLock) throw new Error(`stale registry license evidence not present in Cargo.lock: ${key}`);
  }
}

const report = {
  schemaVersion: '1.0.0',
  npm,
  cargo: {
    packageCount: cargo.length,
    unresolved: cargo.filter((pkg) => pkg.license === 'UNRESOLVED').map(({ name, version }) => ({ name, version })),
    unlicensedWorkspace: cargo.filter((pkg) => pkg.license === 'UNLICENSED').map(({ name, version }) => ({ name, version })),
    licenseCounts: Object.entries(Object.groupBy(cargo, (pkg) => pkg.license)).map(([license, packages]) => ({ license, packageCount: packages.length })),
  },
  foundry: [{ name: basename('forge-std'), license: 'Apache-2.0 OR MIT', evidence: 'contracts/lib/forge-std/LICENSE-APACHE and LICENSE-MIT' }],
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`dependency license report: npm-groups=${npm.length} cargo-packages=${cargo.length} cargo-unresolved=${report.cargo.unresolved.length} output=${output}`);
