// SPDX-License-Identifier: Apache-2.0
// Milestone 6: composed verification of a DecisionReceiptV1 plus the
// AnchorRecordV1 claiming it was anchored on-chain. Two entry points:
//
// - verifyReceiptAgainstSuppliedBatch is the low-level, pure primitive --
//   it trusts whatever onChainBatch object its caller supplies. Easy to
//   unit test without a live/mocked chain connection, but not itself a
//   trust boundary; nothing about its name claims otherwise.
// - verifyAnchoredDecisionReceipt is the actual trust boundary: it fetches
//   getBatch itself, through a ChainReader bound at construction to one
//   configured chainId/contractAddress, so a caller cannot substitute a
//   stale or fabricated batch object -- there is no parameter for one.

import type { Sha256Digest } from '@ddn/crypto';
import { computeReceiptId, verifyDecisionReceipt, type DecisionReceiptV1, type ReceiptVerificationResult } from './decision-receipt.js';
import type { ValidatorSetV1 } from './validator-set.js';
import { computeLeafHash, verifyMerkleProof } from './merkle.js';
import type { AnchorRecordV1 } from './anchor-record.js';

export type AnchoredVerificationFailure = 'RECEIPT' | 'LEAF_MISMATCH' | 'PROOF' | 'ON_CHAIN_MISMATCH' | 'CHAIN_BINDING';

export interface AnchoredVerificationResult {
  readonly ok: boolean;
  readonly failedAt?: AnchoredVerificationFailure;
  readonly detail?: string;
  /** Populated only when failedAt === 'RECEIPT' (or on success) -- the full
   * per-check breakdown from verifyDecisionReceipt, so a caller sees
   * exactly which of the receipt's own checks failed, not just that
   * "RECEIPT" did. */
  readonly receiptVerification?: ReceiptVerificationResult;
}

export interface OnChainBatch {
  readonly merkleRoot: Sha256Digest;
  readonly decisionCount: number;
}

export interface TrustedChainBinding {
  readonly chainId: number;
  readonly contractAddress: string;
}

function fail(failedAt: AnchoredVerificationFailure, detail: string): AnchoredVerificationResult {
  return { ok: false, failedAt, detail };
}

/**
 * Low-level, pure verifier: trusts whatever `onChainBatch` its caller
 * supplies. Deliberately not named a "trusted" verifier -- a caller who
 * fabricates or replays a stale onChainBatch here gets exactly what they
 * asked for. Use verifyAnchoredDecisionReceipt for the real trust boundary.
 *
 * Order of checks, each a hard gate, never short-circuited into "looks
 * fine overall":
 *   1. Full receipt self-verification (schema/signatures/quorum/receiptId).
 *   2. Recompute receiptId + leafHash from the receipt itself; compare
 *      against the anchor record's own receiptId/proof.leafHash -- never
 *      trust either field blindly, even here.
 *   3. Structural proof checks: leafIndex < totalLeaves, exact proof
 *      length, and proof.totalLeaves === onChainBatch.decisionCount.
 *   4. Replay the proof to confirm it reconstructs anchorRecord.merkleRoot.
 *   5. Confirm anchorRecord.merkleRoot equals the independently supplied
 *      onChainBatch.merkleRoot (decisionCount equality already required by
 *      step 3).
 *   6. Confirm anchorRecord.chain matches the caller-configured
 *      trustedChain.
 */
export function verifyReceiptAgainstSuppliedBatch(
  receipt: unknown,
  validatorSet: ValidatorSetV1,
  anchorRecord: AnchorRecordV1,
  onChainBatch: OnChainBatch,
  trustedChain: TrustedChainBinding
): AnchoredVerificationResult {
  const receiptVerification = verifyDecisionReceipt(receipt, validatorSet);
  if (!receiptVerification.ok) {
    return { ok: false, failedAt: 'RECEIPT', detail: 'the receipt itself failed self-verification', receiptVerification };
  }
  const parsed = receipt as DecisionReceiptV1;

  // receiptId is deliberately discarded here: computeReceiptId takes
  // everything BUT it, and this function never trusts the receipt's own
  // embedded value.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { receiptId, ...content } = parsed;
  const recomputedReceiptId = computeReceiptId(content);
  const recomputedLeafHash = computeLeafHash(recomputedReceiptId);
  if (recomputedReceiptId !== anchorRecord.receiptId) {
    return fail('LEAF_MISMATCH', 'recomputed receiptId does not match anchorRecord.receiptId');
  }
  if (recomputedLeafHash !== anchorRecord.proof.leafHash) {
    return fail('LEAF_MISMATCH', 'recomputed leafHash does not match anchorRecord.proof.leafHash');
  }

  const { proof } = anchorRecord;
  if (proof.leafIndex < 0 || proof.leafIndex >= proof.totalLeaves) {
    return fail('PROOF', 'proof.leafIndex is out of range for proof.totalLeaves');
  }
  const expectedLength = proof.totalLeaves === 1 ? 0 : Math.ceil(Math.log2(proof.totalLeaves));
  if (proof.siblings.length !== expectedLength) {
    return fail('PROOF', `expected ${expectedLength} siblings for totalLeaves=${proof.totalLeaves}, got ${proof.siblings.length}`);
  }
  if (proof.totalLeaves !== onChainBatch.decisionCount) {
    return fail('PROOF', 'proof.totalLeaves does not match the on-chain batch decisionCount');
  }

  const proofResult = verifyMerkleProof(proof, anchorRecord.merkleRoot);
  if (!proofResult.ok) {
    return fail('PROOF', proofResult.reason ?? 'Merkle proof did not reconstruct anchorRecord.merkleRoot');
  }

  if (anchorRecord.merkleRoot !== onChainBatch.merkleRoot) {
    return fail('ON_CHAIN_MISMATCH', 'anchorRecord.merkleRoot does not match the independently supplied on-chain batch');
  }

  if (anchorRecord.chain.chainId !== trustedChain.chainId || anchorRecord.chain.contractAddress !== trustedChain.contractAddress) {
    return fail('CHAIN_BINDING', 'anchorRecord.chain does not match the caller-configured trusted chain');
  }

  return { ok: true, receiptVerification };
}

/** Lightweight chain-reading dependency this SDK needs -- deliberately
 * minimal (just getBatch, bound to one configured chainId/contractAddress)
 * and separate from the anchor worker's own, much broader chain client
 * (submission, transaction receipts, block/blockHash reads for
 * confirmation and reorg tracking -- none of which a verifier needs). Any
 * object satisfying this shape, including the anchor worker's own chain
 * client, can be passed here. */
export interface ChainReader {
  readonly chainId: number;
  readonly contractAddress: string;
  getBatch(batchId: Sha256Digest): Promise<OnChainBatch>;
}

/**
 * The actual trust boundary: fetches getBatch itself, through a
 * ChainReader bound at construction to one configured chainId/
 * contractAddress -- a caller cannot substitute a stale or fabricated
 * batch object, since there is no parameter for one. Checks chain binding
 * before ever calling the reader, so a record claiming the wrong
 * chain/contract never triggers a network call in the first place.
 */
export async function verifyAnchoredDecisionReceipt(
  receipt: unknown,
  validatorSet: ValidatorSetV1,
  anchorRecord: AnchorRecordV1,
  chainReader: ChainReader
): Promise<AnchoredVerificationResult> {
  const trustedChain: TrustedChainBinding = { chainId: chainReader.chainId, contractAddress: chainReader.contractAddress };
  if (anchorRecord.chain.chainId !== trustedChain.chainId || anchorRecord.chain.contractAddress !== trustedChain.contractAddress) {
    return fail('CHAIN_BINDING', "anchorRecord.chain does not match this ChainReader's configured chain");
  }
  const onChainBatch = await chainReader.getBatch(anchorRecord.batchId);
  return verifyReceiptAgainstSuppliedBatch(receipt, validatorSet, anchorRecord, onChainBatch, trustedChain);
}
