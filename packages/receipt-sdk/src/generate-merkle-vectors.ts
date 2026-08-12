#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Milestone 6: golden Merkle vectors for packages/test-vectors/vectors/merkle-v1/
// -- fixed, hardcoded receiptIds (never randomly generated per run) run
// through this package's own buildMerkleTree/buildMerkleProof, with every
// leaf hash, root, and inclusion proof written to a committed JSON file. A
// TypeScript test (merkle-golden-vectors.test.ts) compares live
// recomputation against these committed files; only
// `generate-merkle-vectors --confirm-update` may rewrite them, mirroring
// apps/coordinator's `generate-golden-vectors --confirm-update` governance
// for decision-receipt-v1/. See docs/anchor-v1.md.
//
// --check: fails loudly if a committed file doesn't match what this
// package's current implementation produces.
// --confirm-update: the only way to (re)write the files. No argument-less
// default.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Sha256Digest } from '@ddn/crypto';
import { buildMerkleProof, buildMerkleTree, type MerkleProofV1 } from './merkle.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VECTORS_DIR = join(REPO_ROOT, 'packages/test-vectors/vectors/merkle-v1');

interface MerkleVectorCase {
  readonly name: string;
  readonly description: string;
  /** Deliberately not pre-sorted -- proves the committed vector reflects
   * buildMerkleTree's own sort-by-receiptId, not an assumption baked into
   * this generator's input order. */
  readonly receiptIds: readonly Sha256Digest[];
}

// Fixed, hardcoded hex digests -- distinct per case so no value is ever
// reused across the three files.
const CASES: readonly MerkleVectorCase[] = [
  {
    name: 'single-leaf',
    description: 'One receipt: root === leafHash directly, proof has zero siblings.',
    receiptIds: [`sha256:${'88'.repeat(32)}` as Sha256Digest],
  },
  {
    name: 'even-leaf-count',
    description: 'Four receipts (a power of two): every proof has exactly 2 siblings, no odd-node duplication needed.',
    receiptIds: [
      `sha256:${'44'.repeat(32)}` as Sha256Digest,
      `sha256:${'11'.repeat(32)}` as Sha256Digest,
      `sha256:${'33'.repeat(32)}` as Sha256Digest,
      `sha256:${'22'.repeat(32)}` as Sha256Digest,
    ],
  },
  {
    name: 'odd-leaf-count',
    description: 'Three receipts: exercises odd-node self-duplication at the leaf level while building the 2-node top level.',
    receiptIds: [
      `sha256:${'77'.repeat(32)}` as Sha256Digest,
      `sha256:${'55'.repeat(32)}` as Sha256Digest,
      `sha256:${'66'.repeat(32)}` as Sha256Digest,
    ],
  },
];

interface MerkleVectorFile {
  readonly schemaVersion: '1.0.0';
  readonly description: string;
  readonly receiptIds: readonly Sha256Digest[];
  readonly sortedReceiptIds: readonly Sha256Digest[];
  readonly leaves: readonly Sha256Digest[];
  readonly root: Sha256Digest;
  readonly proofs: Record<string, MerkleProofV1>;
}

function buildVectorFile(vectorCase: MerkleVectorCase): MerkleVectorFile {
  const tree = buildMerkleTree(vectorCase.receiptIds);
  const proofs: Record<string, MerkleProofV1> = {};
  for (const receiptId of tree.receiptIds) {
    proofs[receiptId] = buildMerkleProof(tree, receiptId);
  }
  return {
    schemaVersion: '1.0.0',
    description: vectorCase.description,
    receiptIds: vectorCase.receiptIds,
    sortedReceiptIds: tree.receiptIds,
    leaves: tree.leaves,
    root: tree.root,
    proofs,
  };
}

function serialize(file: MerkleVectorFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      'confirm-update': { type: 'boolean', default: false },
    },
  });

  if (values.check === values['confirm-update']) {
    throw new Error('pass exactly one of --check or --confirm-update');
  }

  if (values['confirm-update']) {
    await mkdir(VECTORS_DIR, { recursive: true });
    for (const vectorCase of CASES) {
      const path = join(VECTORS_DIR, `${vectorCase.name}.json`);
      await writeFile(path, serialize(buildVectorFile(vectorCase)));
      console.log(`wrote ${path}`);
    }
    return;
  }

  let anyMismatch = false;
  for (const vectorCase of CASES) {
    const path = join(VECTORS_DIR, `${vectorCase.name}.json`);
    const generated = serialize(buildVectorFile(vectorCase));
    let committed: string;
    try {
      committed = await readFile(path, 'utf8');
    } catch {
      console.error(`${path} does not exist -- run \`pnpm --filter @ddn/receipt-sdk run vectors:generate\` and commit the result`);
      anyMismatch = true;
      continue;
    }
    if (committed !== generated) {
      console.error(`${path} is out of date with the current implementation -- run \`pnpm --filter @ddn/receipt-sdk run vectors:generate\` and commit the result`);
      anyMismatch = true;
      continue;
    }
    console.log(`${path} is up to date`);
  }
  if (anyMismatch) throw new Error('one or more merkle-v1 golden vectors are out of date');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
