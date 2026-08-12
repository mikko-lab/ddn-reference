// SPDX-License-Identifier: Apache-2.0
// Error taxonomy for @ddn/client-sdk. Every failure mode an external
// caller needs to distinguish (a rejected request, a network problem, a
// decision that resolved to NO_QUORUM/FAILED, a receipt that failed local
// verification, a poll that timed out) gets its own class rather than one
// generic Error, so callers can `instanceof`-branch instead of parsing
// messages.

import type { ApiErrorResponseV1 } from '@ddn/schemas';
import type { AnchoredVerificationResult, ReceiptVerificationResult } from '@ddn/receipt-sdk';

export class DdnClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DdnClientError';
  }
}

/** The server responded with an ApiErrorResponseV1 (4xx/5xx after retries
 * were exhausted for 5xx). */
export class DdnApiError extends DdnClientError {
  readonly code: string;
  readonly httpStatus: number;
  readonly requestId: string;

  constructor(response: ApiErrorResponseV1, httpStatus: number) {
    super(response.error.message);
    this.name = 'DdnApiError';
    this.code = response.error.code;
    this.httpStatus = httpStatus;
    this.requestId = response.error.requestId;
  }
}

/** Every retry attempt failed at the transport level (no HTTP response at
 * all -- DNS, connection refused, etc.), or every retried 5xx was
 * exhausted. */
export class DdnNetworkError extends DdnClientError {
  constructor(message: string) {
    super(message);
    this.name = 'DdnNetworkError';
  }
}

/** submitWaitAndVerify polled past its timeoutMs without the decision
 * reaching a terminal state. */
export class DdnTimeoutError extends DdnClientError {
  readonly decisionId: string;

  constructor(decisionId: string, timeoutMs: number) {
    super(`decision ${decisionId} did not reach a terminal state within ${timeoutMs}ms`);
    this.name = 'DdnTimeoutError';
    this.decisionId = decisionId;
  }
}

/** The decision itself resolved to a terminal error state (NO_QUORUM or
 * FAILED) -- not a client/network problem, the coordinator could not
 * produce a decision at all. */
export class DdnDecisionFailedError extends DdnClientError {
  readonly decisionId: string;
  readonly status: 'NO_QUORUM' | 'FAILED';
  readonly code: string;

  constructor(decisionId: string, status: 'NO_QUORUM' | 'FAILED', error: { readonly code: string; readonly message: string }) {
    super(`decision ${decisionId} resolved to ${status}: ${error.message}`);
    this.name = 'DdnDecisionFailedError';
    this.decisionId = decisionId;
    this.status = status;
    this.code = error.code;
  }
}

/** The whole point of submitWaitAndVerify: the server claimed FINALIZED,
 * but this client's own, local, @ddn/receipt-sdk verification of the raw
 * receipt against its own trusted ValidatorSetV1 did not pass. Never
 * silently downgraded to a warning -- a client that ignored this would be
 * trusting the server's claim anyway, defeating the reason this SDK
 * fetches and verifies the receipt at all. */
export class DdnReceiptVerificationError extends DdnClientError {
  readonly decisionId: string;
  readonly verification: ReceiptVerificationResult;

  constructor(decisionId: string, verification: ReceiptVerificationResult) {
    const failed = verification.checks.filter((c) => !c.passed).map((c) => c.name);
    super(`decision ${decisionId}'s receipt failed local self-verification: ${failed.join(', ')}`);
    this.name = 'DdnReceiptVerificationError';
    this.decisionId = decisionId;
    this.verification = verification;
  }
}

/** fetchAndVerifyAnchor's own fail-closed signal: the server returned an
 * anchor record (so no DdnApiError/DdnNetworkError applies), but this
 * client's own, local call to verifyAnchoredDecisionReceipt -- against its
 * own trusted ValidatorSetV1 and its own caller-supplied ChainReader --
 * did not pass. Never downgraded to a boolean or a warning; a caller that
 * ignored this would be trusting the server's anchor claim directly,
 * defeating the reason this SDK verifies it at all. */
export class DdnAnchorVerificationError extends DdnClientError {
  readonly decisionId: string;
  readonly verification: AnchoredVerificationResult;

  constructor(decisionId: string, verification: AnchoredVerificationResult) {
    super(`decision ${decisionId}'s anchor failed verification at ${verification.failedAt ?? 'UNKNOWN'}: ${verification.detail ?? 'no detail'}`);
    this.name = 'DdnAnchorVerificationError';
    this.decisionId = decisionId;
    this.verification = verification;
  }
}
