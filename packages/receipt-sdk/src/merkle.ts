// SPDX-License-Identifier: Apache-2.0
// Milestone 6: Merkle tree/proof construction for anchoring batches of
// receiptIds on-chain. A leaf commits to nothing but a receipt's own
// receiptId -- already a full hash over that receipt's
// request/quorum/consensus/signedResults (see decision-receipt.ts's
// computeReceiptId) -- so scanning the public tree alone reveals nothing
// about a receipt's tenant or content. See docs/decision-receipt-v1.md and
// ADR-001/ADR-005 for what the on-chain anchor is and isn't allowed to hold.

import { hashCanonicalJson, type Sha256Digest } from '@ddn/crypto';

export const RECEIPT_LEAF_DOMAIN_V1 = 'DDN_RECEIPT_LEAF_V1';
export const MERKLE_NODE_DOMAIN_V1 = 'DDN_MERKLE_NODE_V1';
export const ANCHOR_BATCH_DOMAIN_V1 = 'DDN_ANCHOR_BATCH_V1';

export type MerkleErrorCode = 'EMPTY_BATCH' | 'DUPLICATE_RECEIPT_ID' | 'RECEIPT_NOT_IN_TREE';

export class MerkleError extends Error {
  readonly code: MerkleErrorCode;
  constructor(code: MerkleErrorCode, message: string) {
    super(message);
    this.name = 'MerkleError';
    this.code = code;
  }
}

/** `leafHash = hash("DDN_RECEIPT_LEAF_V1", { receiptId })` -- nothing else.
 * Callers must pass a receiptId freshly recomputed from the receipt's
 * actual content (e.g. via computeReceiptId), never one read verbatim off
 * a storage row, so a receipt corrupted independently of its own
 * `receiptId` field can never be anchored under a stale/wrong leaf. */
export function computeLeafHash(receiptId: Sha256Digest): Sha256Digest {
  return hashCanonicalJson(RECEIPT_LEAF_DOMAIN_V1, { receiptId });
}

function combine(left: Sha256Digest, right: Sha256Digest): Sha256Digest {
  return hashCanonicalJson(MERKLE_NODE_DOMAIN_V1, { left, right });
}

function nextLevel(level: readonly Sha256Digest[]): Sha256Digest[] {
  const next: Sha256Digest[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i]!;
    // A lone node at any level (not just the leaf level) is paired with a
    // duplicate of itself to advance -- applied recursively bottom-up so a
    // proof's siblings reflect the real tree shape at every height.
    const right = i + 1 < level.length ? level[i + 1]! : left;
    next.push(combine(left, right));
  }
  return next;
}

export interface MerkleProofV1 {
  readonly leafHash: Sha256Digest;
  readonly leafIndex: number;
  readonly siblings: readonly Sha256Digest[];
  readonly totalLeaves: number;
}

export interface MerkleTreeV1 {
  readonly root: Sha256Digest;
  /** Leaf hashes, sorted by the receiptId they were built from -- index
   * order here is what `leafIndex` refers to everywhere else. */
  readonly leaves: readonly Sha256Digest[];
  /** Same order as `leaves`, so a caller can look up a proof by receiptId. */
  readonly receiptIds: readonly Sha256Digest[];
}

/**
 * Builds a batch's Merkle tree from a set of receiptIds. Leaves are sorted
 * lexicographically by receiptId first, so the tree's shape (and therefore
 * its root) never depends on collection order. Throws
 * MerkleError('DUPLICATE_RECEIPT_ID', ...) if the same receiptId appears
 * twice -- a duplicate is either a bug in the anchor-eligible queue or an
 * attempted double-count, and batch construction must reject it, not
 * silently absorb it into the tree.
 */
export function buildMerkleTree(receiptIds: readonly Sha256Digest[]): MerkleTreeV1 {
  if (receiptIds.length === 0) {
    throw new MerkleError('EMPTY_BATCH', 'cannot build a Merkle tree from zero receipts');
  }
  const sortedReceiptIds = [...receiptIds].sort();
  for (let i = 1; i < sortedReceiptIds.length; i++) {
    if (sortedReceiptIds[i] === sortedReceiptIds[i - 1]) {
      throw new MerkleError('DUPLICATE_RECEIPT_ID', `duplicate receiptId in batch: ${sortedReceiptIds[i]}`);
    }
  }

  const leaves = sortedReceiptIds.map(computeLeafHash);
  let level: readonly Sha256Digest[] = leaves;
  while (level.length > 1) {
    level = nextLevel(level);
  }

  return { root: level[0]!, leaves, receiptIds: sortedReceiptIds };
}

/** Builds the inclusion proof for one receiptId already part of `tree`.
 * Throws MerkleError('RECEIPT_NOT_IN_TREE', ...) otherwise. */
export function buildMerkleProof(tree: MerkleTreeV1, receiptId: Sha256Digest): MerkleProofV1 {
  const leafIndex = tree.receiptIds.indexOf(receiptId);
  if (leafIndex === -1) {
    throw new MerkleError('RECEIPT_NOT_IN_TREE', `receiptId is not part of this tree: ${receiptId}`);
  }

  const siblings: Sha256Digest[] = [];
  let level: readonly Sha256Digest[] = tree.leaves;
  let index = leafIndex;
  while (level.length > 1) {
    const isLeftChild = index % 2 === 0;
    const siblingIndex = isLeftChild ? index + 1 : index - 1;
    // Out of range only happens for a lone left-child at the end of an odd
    // level -- its sibling in the tree is a duplicate of itself.
    siblings.push(siblingIndex < level.length ? level[siblingIndex]! : level[index]!);
    level = nextLevel(level);
    index = Math.floor(index / 2);
  }

  return { leafHash: tree.leaves[leafIndex]!, leafIndex, siblings, totalLeaves: tree.leaves.length };
}

export interface MerkleVerificationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Verifies a MerkleProofV1 reconstructs `expectedRoot`. Every structural
 * check (leafIndex range, exact proof length) runs before any hashing, so a
 * truncated, padded, or out-of-range proof is rejected outright rather than
 * by accident producing a hash that happens not to match.
 */
export function verifyMerkleProof(proof: MerkleProofV1, expectedRoot: Sha256Digest): MerkleVerificationResult {
  if (proof.totalLeaves < 1) return { ok: false, reason: 'totalLeaves must be at least 1' };
  if (proof.leafIndex < 0 || proof.leafIndex >= proof.totalLeaves) {
    return { ok: false, reason: 'leafIndex out of range for totalLeaves' };
  }
  const expectedLength = proof.totalLeaves === 1 ? 0 : Math.ceil(Math.log2(proof.totalLeaves));
  if (proof.siblings.length !== expectedLength) {
    return {
      ok: false,
      reason: `expected ${expectedLength} siblings for totalLeaves=${proof.totalLeaves}, got ${proof.siblings.length}`,
    };
  }

  let currentHash: Sha256Digest = proof.leafHash;
  let currentIndex = proof.leafIndex;
  let levelSize = proof.totalLeaves;

  for (const sibling of proof.siblings) {
    const isLeftChild = currentIndex % 2 === 0;
    const isLastOddNodeAtLevel = isLeftChild && currentIndex === levelSize - 1;

    if (isLastOddNodeAtLevel) {
      // The tree-builder duplicated this exact node to advance it -- reject
      // any proof claiming that duplication with a different hash, which
      // would let an attacker substitute an unrelated hash at this boundary.
      if (sibling !== currentHash) {
        return { ok: false, reason: 'expected a self-duplicate sibling at an odd tree level, got a different hash' };
      }
      currentHash = combine(currentHash, currentHash);
    } else if (isLeftChild) {
      currentHash = combine(currentHash, sibling);
    } else {
      currentHash = combine(sibling, currentHash);
    }

    currentIndex = Math.floor(currentIndex / 2);
    levelSize = Math.ceil(levelSize / 2);
  }

  if (currentHash !== expectedRoot) {
    return { ok: false, reason: 'reconstructed root does not match expectedRoot' };
  }
  return { ok: true };
}

/** `batchId = hash("DDN_ANCHOR_BATCH_V1", { merkleRoot, decisionCount })` --
 * deliberately content-derived only, no sequence counter. Two batches
 * sharing both fields necessarily contain the same receiptId set (the root
 * already strongly commits to content), so collapsing them under one
 * batchId is correct, not a collision risk -- it makes retrying an
 * identical batch (e.g. after a crash) naturally idempotent. */
export function computeBatchId(merkleRoot: Sha256Digest, decisionCount: number): Sha256Digest {
  return hashCanonicalJson(ANCHOR_BATCH_DOMAIN_V1, { merkleRoot, decisionCount });
}
