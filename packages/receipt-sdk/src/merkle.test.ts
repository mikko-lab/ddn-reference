// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Text, type Sha256Digest } from '@ddn/crypto';
import { buildMerkleProof, buildMerkleTree, computeBatchId, computeLeafHash, MerkleError, verifyMerkleProof } from './merkle.js';

function receiptId(label: string): Sha256Digest {
  return sha256Text(label);
}

test('buildMerkleTree rejects an empty batch', () => {
  assert.throws(() => buildMerkleTree([]), MerkleError);
});

test('buildMerkleTree rejects a duplicate receiptId', () => {
  const id = receiptId('r1');
  assert.throws(() => buildMerkleTree([id, receiptId('r2'), id]), (error: unknown) => {
    assert.ok(error instanceof MerkleError);
    assert.equal(error.code, 'DUPLICATE_RECEIPT_ID');
    return true;
  });
});

test('a single-leaf tree has root === leafHash directly, with an empty-siblings proof', () => {
  const id = receiptId('only');
  const tree = buildMerkleTree([id]);
  assert.equal(tree.root, computeLeafHash(id));

  const proof = buildMerkleProof(tree, id);
  assert.deepEqual(proof, { leafHash: computeLeafHash(id), leafIndex: 0, siblings: [], totalLeaves: 1 });
  assert.deepEqual(verifyMerkleProof(proof, tree.root), { ok: true });
});

test('tree shape is independent of input collection order', () => {
  const ids = [receiptId('c'), receiptId('a'), receiptId('b')];
  const treeA = buildMerkleTree(ids);
  const treeB = buildMerkleTree([...ids].reverse());
  assert.equal(treeA.root, treeB.root);
  assert.deepEqual(treeA.receiptIds, treeB.receiptIds);
});

test('every leaf in a 2-leaf tree produces a valid proof', () => {
  const ids = [receiptId('x'), receiptId('y')];
  const tree = buildMerkleTree(ids);
  for (const id of ids) {
    const proof = buildMerkleProof(tree, id);
    assert.equal(proof.siblings.length, 1);
    assert.deepEqual(verifyMerkleProof(proof, tree.root), { ok: true });
  }
});

test('an odd-sized (3-leaf) tree duplicates the lone node at every level it lacks a sibling', () => {
  const ids = [receiptId('p'), receiptId('q'), receiptId('r')];
  const tree = buildMerkleTree(ids);
  for (const id of ids) {
    const proof = buildMerkleProof(tree, id);
    assert.equal(proof.siblings.length, 2); // ceil(log2(3)) === 2
    assert.deepEqual(verifyMerkleProof(proof, tree.root), { ok: true });
  }
});

test('a larger (5-leaf) tree verifies every leaf', () => {
  const ids = Array.from({ length: 5 }, (_, i) => receiptId(`leaf-${i}`));
  const tree = buildMerkleTree(ids);
  for (const id of ids) {
    const proof = buildMerkleProof(tree, id);
    assert.deepEqual(verifyMerkleProof(proof, tree.root), { ok: true });
  }
});

test('buildMerkleProof throws for a receiptId not in the tree', () => {
  const tree = buildMerkleTree([receiptId('a'), receiptId('b')]);
  assert.throws(() => buildMerkleProof(tree, receiptId('not-in-tree')), MerkleError);
});

test('verifyMerkleProof rejects a tampered leafHash', () => {
  const ids = [receiptId('a'), receiptId('b'), receiptId('c'), receiptId('d')];
  const tree = buildMerkleTree(ids);
  const proof = buildMerkleProof(tree, ids[0]!);
  const tampered = { ...proof, leafHash: receiptId('forged') };
  assert.equal(verifyMerkleProof(tampered, tree.root).ok, false);
});

test('verifyMerkleProof rejects a tampered sibling', () => {
  const ids = [receiptId('a'), receiptId('b'), receiptId('c'), receiptId('d')];
  const tree = buildMerkleTree(ids);
  const proof = buildMerkleProof(tree, ids[0]!);
  const tampered = { ...proof, siblings: [receiptId('forged'), ...proof.siblings.slice(1)] };
  assert.equal(verifyMerkleProof(tampered, tree.root).ok, false);
});

test('verifyMerkleProof rejects a truncated proof (wrong length for totalLeaves)', () => {
  const ids = [receiptId('a'), receiptId('b'), receiptId('c'), receiptId('d')];
  const tree = buildMerkleTree(ids);
  const proof = buildMerkleProof(tree, ids[0]!);
  const truncated = { ...proof, siblings: proof.siblings.slice(0, -1) };
  const result = verifyMerkleProof(truncated, tree.root);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /expected 2 siblings/);
});

test('verifyMerkleProof rejects an out-of-range leafIndex', () => {
  const tree = buildMerkleTree([receiptId('a'), receiptId('b')]);
  const proof = buildMerkleProof(tree, tree.receiptIds[0]!);
  assert.equal(verifyMerkleProof({ ...proof, leafIndex: 5 }, tree.root).ok, false);
  assert.equal(verifyMerkleProof({ ...proof, leafIndex: -1 }, tree.root).ok, false);
});

test('verifyMerkleProof rejects a forged self-duplicate sibling at an odd level', () => {
  const ids = [receiptId('a'), receiptId('b'), receiptId('c')];
  const tree = buildMerkleTree(ids);
  const proof = buildMerkleProof(tree, ids[2]!); // the lone node at the leaf level
  const forged = { ...proof, siblings: [receiptId('not-a-self-duplicate'), proof.siblings[1]!] };
  assert.equal(verifyMerkleProof(forged, tree.root).ok, false);
});

test('computeBatchId is a pure function of (merkleRoot, decisionCount), no external counter', () => {
  const root = receiptId('root');
  assert.equal(computeBatchId(root, 3), computeBatchId(root, 3));
  assert.notEqual(computeBatchId(root, 3), computeBatchId(root, 4));
});
