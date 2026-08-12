// SPDX-License-Identifier: Apache-2.0
// The single, three-way verification outcome rendered by the public reference
// surfaces.
// Composes verifyDecisionReceipt and verifyAnchoredDecisionReceipt (both
// already this SDK's own trust boundaries) into exactly one function, so
// there is one canonical place deciding what VALID/INVALID/INCOMPLETE
// means -- not one definition per app.
//
// VALID: the receipt passed self-verification against the trusted
// validator set, AND an anchor record was supplied and passed every
// on-chain check (leaf/proof/root/chain-binding) against a live chain
// read.
// INVALID: a real check failed -- the receipt itself, or the anchor
// record against the receipt or the on-chain state.
// INCOMPLETE: no anchor record was supplied, no chain reader is
// configured, or the chain read itself failed (RPC/transport error).
// Never INVALID for any of these -- anchoring is decoupled from decision
// finality (ADR-001/ADR-005), and a transport failure is not a tamper
// finding.

import type { AnchorRecordV1 } from './anchor-record.js';
import { verifyAnchoredDecisionReceipt, type AnchoredVerificationResult, type ChainReader } from './anchor-verification.js';
import { verifyDecisionReceipt, type ReceiptVerificationResult } from './decision-receipt.js';
import type { ValidatorSetV1 } from './validator-set.js';

export type VerificationOutcome = 'VALID' | 'INVALID' | 'INCOMPLETE';

export interface VerificationOutcomeResult {
  readonly outcome: VerificationOutcome;
  readonly detail: string;
  readonly receiptVerification?: ReceiptVerificationResult;
  readonly anchorVerification?: AnchoredVerificationResult;
}

export async function computeVerificationOutcome(
  receipt: unknown,
  validatorSet: ValidatorSetV1,
  anchorRecord: AnchorRecordV1 | undefined,
  chainReader: ChainReader | undefined
): Promise<VerificationOutcomeResult> {
  const receiptVerification = verifyDecisionReceipt(receipt, validatorSet);
  if (!receiptVerification.ok) {
    return {
      outcome: 'INVALID',
      detail: 'the receipt failed self-verification against the trusted validator set',
      receiptVerification,
    };
  }

  if (!anchorRecord) {
    return {
      outcome: 'INCOMPLETE',
      detail: 'no on-chain anchor record was supplied -- anchoring is decoupled from decision finality (see ADR-001/ADR-005)',
      receiptVerification,
    };
  }
  if (!chainReader) {
    return {
      outcome: 'INCOMPLETE',
      detail: 'an anchor record was supplied but no chain reader is configured -- cannot confirm the on-chain root',
      receiptVerification,
    };
  }

  let anchorVerification: AnchoredVerificationResult;
  try {
    anchorVerification = await verifyAnchoredDecisionReceipt(receipt, validatorSet, anchorRecord, chainReader);
  } catch (error) {
    return {
      outcome: 'INCOMPLETE',
      detail: `could not reach the chain to verify the on-chain anchor: ${error instanceof Error ? error.message : String(error)}`,
      receiptVerification,
    };
  }

  if (!anchorVerification.ok) {
    return {
      outcome: 'INVALID',
      detail: anchorVerification.detail ?? 'the on-chain anchor check failed',
      receiptVerification,
      anchorVerification,
    };
  }

  return { outcome: 'VALID', detail: 'every check passed', receiptVerification, anchorVerification };
}
