// SPDX-License-Identifier: Apache-2.0
// Proves the committed golden vectors under
// packages/test-vectors/vectors/merkle-v1/ match what this package's own
// buildMerkleTree/buildMerkleProof/verifyMerkleProof recompute live --
// single-leaf, even-leaf-count, and odd-leaf-count cases, with fixed,
// hardcoded receiptIds (never randomly generated per run). Nothing here
// computes an expected value inline with the same implementation under
// test: every leaf hash, root, and proof is loaded from a file committed
// to git and compared against a fresh computation. Only
// `generate-merkle-vectors --confirm-update` may rewrite these files;
// this test never does. See docs/anchor-v1.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sha256Digest } from '@ddn/crypto';
import { buildMerkleProof, buildMerkleTree, verifyMerkleProof, type MerkleProofV1 } from './merkle.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VECTORS_DIR = join(REPO_ROOT, 'packages/test-vectors/vectors/merkle-v1');

interface MerkleVectorFile {
  readonly schemaVersion: '1.0.0';
  readonly description: string;
  readonly receiptIds: readonly Sha256Digest[];
  readonly sortedReceiptIds: readonly Sha256Digest[];
  readonly leaves: readonly Sha256Digest[];
  readonly root: Sha256Digest;
  readonly proofs: Record<string, MerkleProofV1>;
}

async function readVector(name: string): Promise<MerkleVectorFile> {
  return JSON.parse(await readFile(join(VECTORS_DIR, `${name}.json`), 'utf8')) as MerkleVectorFile;
}

const CASES = ['single-leaf', 'even-leaf-count', 'odd-leaf-count'] as const;

for (const caseName of CASES) {
  test(`committed merkle-v1/${caseName}.json: tree/root match live recomputation from the same (unsorted) receiptIds`, async () => {
    const vector = await readVector(caseName);
    const tree = buildMerkleTree(vector.receiptIds);
    assert.deepEqual(tree.receiptIds, vector.sortedReceiptIds);
    assert.deepEqual(tree.leaves, vector.leaves);
    assert.equal(tree.root, vector.root);
  });

  test(`committed merkle-v1/${caseName}.json: every committed proof matches a freshly built one and verifies`, async () => {
    const vector = await readVector(caseName);
    const tree = buildMerkleTree(vector.receiptIds);
    assert.equal(Object.keys(vector.proofs).length, vector.sortedReceiptIds.length);
    for (const receiptId of vector.sortedReceiptIds) {
      const committedProof = vector.proofs[receiptId];
      assert.ok(committedProof, `no committed proof for ${receiptId}`);
      const freshProof = buildMerkleProof(tree, receiptId);
      assert.deepEqual(freshProof, committedProof);
      assert.deepEqual(verifyMerkleProof(committedProof, vector.root), { ok: true });
    }
  });
}

test('odd-leaf-count.json: the lone leaf-level node carries a self-duplicate sibling, not a distinct hash', async () => {
  const vector = await readVector('odd-leaf-count');
  const lastReceiptId = vector.sortedReceiptIds[vector.sortedReceiptIds.length - 1]!;
  const proof = vector.proofs[lastReceiptId]!;
  assert.equal(proof.siblings[0], proof.leafHash, 'the first sibling at the leaf level must equal the node\'s own hash (self-duplication)');
});

test('single-leaf.json: root equals leafHash directly, with an empty-siblings proof', async () => {
  const vector = await readVector('single-leaf');
  assert.equal(vector.root, vector.leaves[0]);
  const [onlyReceiptId] = vector.sortedReceiptIds;
  assert.deepEqual(vector.proofs[onlyReceiptId!]!.siblings, []);
});

// --- "a single flipped byte in a committed vector must fail verification" ---

test('a tampered sibling in a committed even-leaf-count proof fails verifyMerkleProof', async () => {
  const vector = await readVector('even-leaf-count');
  const [receiptId] = vector.sortedReceiptIds;
  const proof = vector.proofs[receiptId!]!;
  const tampered = { ...proof, siblings: [`sha256:${'0'.repeat(64)}` as Sha256Digest, ...proof.siblings.slice(1)] };
  assert.equal(verifyMerkleProof(tampered, vector.root).ok, false);
});

test('a tampered root fails verifyMerkleProof for every committed odd-leaf-count proof', async () => {
  const vector = await readVector('odd-leaf-count');
  const forgedRoot = `sha256:${'f'.repeat(64)}` as Sha256Digest;
  for (const receiptId of vector.sortedReceiptIds) {
    assert.equal(verifyMerkleProof(vector.proofs[receiptId]!, forgedRoot).ok, false);
  }
});
