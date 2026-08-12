// SPDX-License-Identifier: Apache-2.0
// The one function this whole milestone exists to prove out: an external
// client -- using only the public HTTP API and this reference SDK, no
// import of @ddn/coordinator, no access to the ddn-validator binary or
// any private key -- can submit a decision, poll it, fetch its
// DecisionReceiptV1, verify that receipt LOCALLY with @ddn/receipt-sdk
// against its own trusted ValidatorSetV1, and only then accept the
// result. The server's "FINALIZED" claim and its own /v1/receipts/verify
// convenience endpoint are never the basis for trust here -- only this
// function's own call to verifyDecisionReceipt is.

import { verifyDecisionReceipt, type DecisionReceiptV1, type ReceiptVerificationResult, type ValidatorSetV1 } from '@ddn/receipt-sdk';
import type { SubmitDecisionRequestV1 } from '@ddn/schemas';
import type { DdnClient } from './client.js';
import { DdnDecisionFailedError, DdnReceiptVerificationError, DdnTimeoutError } from './errors.js';

export interface SubmitWaitAndVerifyOptions {
  /** The validator set this caller independently trusts -- never fetched
   * from the server being verified; see docs/api-v1.md's threat model. */
  readonly validatorSet: ValidatorSetV1;
  /** Delay between GET /v1/decisions/{id} polls, in ms. Default 500. */
  readonly pollIntervalMs?: number;
  /** Total time budget from submission to a terminal state, in ms.
   * Default 30000. */
  readonly timeoutMs?: number;
}

export interface SubmitWaitAndVerifyResult {
  readonly decisionId: string;
  readonly result: Record<string, unknown>;
  readonly receipt: DecisionReceiptV1;
  readonly verification: ReceiptVerificationResult;
}

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitWaitAndVerify(
  client: DdnClient,
  request: SubmitDecisionRequestV1,
  options: SubmitWaitAndVerifyOptions
): Promise<SubmitWaitAndVerifyResult> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  let current = await client.submitDecision(request);
  while (current.status === 'PENDING' || current.status === 'RUNNING') {
    if (Date.now() >= deadline) {
      throw new DdnTimeoutError(current.decisionId, timeoutMs);
    }
    await sleep(pollIntervalMs);
    current = await client.getDecision(current.decisionId);
  }

  if (current.status === 'NO_QUORUM' || current.status === 'FAILED') {
    throw new DdnDecisionFailedError(current.decisionId, current.status, current.error);
  }
  if (current.status !== 'FINALIZED') {
    throw new Error(`unreachable: decision ${current.decisionId} left the poll loop with status ${current.status}`);
  }

  const receipt = await client.getDecisionReceipt(current.decisionId);

  const verification = verifyDecisionReceipt(receipt, options.validatorSet);
  if (!verification.ok) {
    throw new DdnReceiptVerificationError(current.decisionId, verification);
  }

  return { decisionId: current.decisionId, result: current.result, receipt, verification };
}
