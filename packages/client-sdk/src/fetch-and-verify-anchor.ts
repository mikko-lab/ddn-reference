// SPDX-License-Identifier: Apache-2.0
// Mirrors submit-wait-and-verify.ts's own reason for existing, for the
// anchor endpoint: an external client -- using only the public HTTP API
// and this reference SDK -- can fetch a decision's receipt and its
// on-chain anchor, and verify the anchor LOCALLY with
// @ddn/receipt-sdk's verifyAnchoredDecisionReceipt against its own trusted
// ValidatorSetV1 and its own trusted ChainReader, rather than accepting
// the server's claim that the receipt was ever anchored at all.

import { parseAnchorRecordV1, verifyAnchoredDecisionReceipt, type AnchorRecordV1, type AnchoredVerificationResult, type ChainReader, type DecisionReceiptV1, type ValidatorSetV1 } from '@ddn/receipt-sdk';
import type { DdnClient } from './client.js';
import { DdnAnchorVerificationError } from './errors.js';

export interface FetchAndVerifyAnchorOptions {
  /** The validator set this caller independently trusts -- never fetched
   * from the server being verified; see docs/api-v1.md's threat model. */
  readonly validatorSet: ValidatorSetV1;
  /** The chain reader this caller independently trusts, bound to the
   * chainId/contractAddress it actually expects -- verifyAnchoredDecisionReceipt
   * fetches getBatch through this itself; the anchor record's own claimed
   * chain binding is checked against it, never assumed. See
   * @ddn/receipt-sdk's anchor-verification.ts. */
  readonly chainReader: ChainReader;
}

export interface FetchAndVerifyAnchorResult {
  readonly decisionId: string;
  readonly receipt: DecisionReceiptV1;
  readonly anchorRecord: AnchorRecordV1;
  readonly verification: AnchoredVerificationResult;
}

/**
 * Fetches a decision's receipt and its anchor record, then verifies the
 * anchor locally. Throws DdnAnchorVerificationError (a typed, fail-closed
 * error -- never a boolean) if verification does not pass; anything else
 * that can go wrong fetching either resource (the decision doesn't exist,
 * belongs to another tenant, hasn't been anchored yet, or the response is
 * malformed) surfaces as whatever DdnClient.request/getDecisionReceipt/
 * getDecisionAnchor themselves already throw (DdnApiError,
 * DdnNetworkError, or a schema/protocol validation error) -- this function
 * adds no swallowing of its own.
 */
export async function fetchAndVerifyAnchor(
  client: DdnClient,
  decisionId: string,
  options: FetchAndVerifyAnchorOptions
): Promise<FetchAndVerifyAnchorResult> {
  const receipt = await client.getDecisionReceipt(decisionId);
  const anchorResponse = await client.getDecisionAnchor(decisionId);
  // Re-validated through @ddn/receipt-sdk's own, stricter parser --
  // client.ts's ajv-based schema check already ran, but this is the same
  // "never trust a single layer's validation as the final word" discipline
  // this codebase already applies elsewhere (e.g. decision-runner.ts still
  // calls verifyDecisionReceipt on a receipt @ddn/coordinator already
  // self-verified).
  const anchorRecord = parseAnchorRecordV1(anchorResponse);

  const verification = await verifyAnchoredDecisionReceipt(receipt, options.validatorSet, anchorRecord, options.chainReader);
  if (!verification.ok) {
    throw new DdnAnchorVerificationError(decisionId, verification);
  }

  return { decisionId, receipt, anchorRecord, verification };
}
