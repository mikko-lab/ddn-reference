#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Computes manifest.json for a policy package directory. Only wasmHash
// participates in reproducible-build comparisons; createdAt is expected to
// vary between builds and must never affect it (see docs/reproducible-builds.md).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error('usage: gen-manifest.mjs <policy-package-dir>');
  process.exit(1);
}

function sha256File(relPath) {
  const bytes = readFileSync(path.join(pkgDir, relPath));
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

const manifest = {
  manifestVersion: '1.0.0',
  policyId: 'negotiation-reference',
  policyVersion: '1.0.0',
  publisherId: 'mikko-lab',
  entrypoint: 'ddn_evaluate',
  executionProfileId: 'ddn-wasm-v1',
  inputSchemaHash: sha256File('input.schema.json'),
  outputSchemaHash: sha256File('output.schema.json'),
  reasonCodeRegistryHash: sha256File('reason-codes.json'),
  wasmHash: sha256File('policy.wasm'),
  testVectorHash: sha256File('test-vectors.json'),
  createdAt: new Date().toISOString(),
};

writeFileSync(path.join(pkgDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${path.join(pkgDir, 'manifest.json')}`);
