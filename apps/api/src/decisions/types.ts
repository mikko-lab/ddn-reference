// SPDX-License-Identifier: Apache-2.0
// Internal decision record and repository contract. Richer than the
// public DecisionStatusResponseV1 (api-v1.ts): it carries the raw request
// (needed for idempotency lookups and for the not-yet-written decision
// runner) and, once FINALIZED, the actual DecisionReceiptV1 the runner
// self-verified before allowing that transition -- never just the
// summary fields the API response exposes.

import type { DecisionStatus, PolicyRefV1 } from '@ddn/schemas';
import type { Sha256Digest } from '@ddn/crypto';
import type { DecisionReceiptV1 } from '@ddn/receipt-sdk';

interface DecisionRecordBase {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly policy: PolicyRefV1;
  readonly input: Record<string, unknown>;
  readonly verificationProfileId: string;
  readonly idempotencyRequestHash: Sha256Digest;
  readonly submittedAt: string;
  readonly updatedAt: string;
}

export interface PendingDecisionRecord extends DecisionRecordBase {
  readonly status: 'PENDING';
}

export interface RunningDecisionRecord extends DecisionRecordBase {
  readonly status: 'RUNNING';
}

export interface FinalizedDecisionRecord extends DecisionRecordBase {
  readonly status: 'FINALIZED';
  /** The policy output value, extracted once from receipt.signedResults[0]
   * for cheap access by the status response mapping -- not a second
   * source of truth, since it is only ever derived from `receipt` at the
   * moment of transition and never independently set. */
  readonly result: Record<string, unknown>;
  readonly receipt: DecisionReceiptV1;
  readonly finalizedAt: string;
}

export interface ErrorDecisionRecord extends DecisionRecordBase {
  readonly status: 'NO_QUORUM' | 'FAILED';
  readonly error: { readonly code: string; readonly message: string };
}

export type DecisionRecord = PendingDecisionRecord | RunningDecisionRecord | FinalizedDecisionRecord | ErrorDecisionRecord;

/** The only transitions the state machine permits. PENDING/RUNNING are the
 * only states anything can move OUT of; FINALIZED/NO_QUORUM/FAILED are
 * terminal. See decision-repository.ts's transition() for enforcement. */
export const ALLOWED_DECISION_TRANSITIONS: Record<DecisionStatus, readonly DecisionStatus[]> = {
  PENDING: ['RUNNING'],
  RUNNING: ['FINALIZED', 'NO_QUORUM', 'FAILED'],
  FINALIZED: [],
  NO_QUORUM: [],
  FAILED: [],
};

export interface DecisionRepository {
  /** Returns the existing record if one already exists for this
   * (tenantId, idempotencyRequestHash) pair; otherwise atomically creates
   * and returns a new PENDING record. Never creates a duplicate for the
   * same idempotency key, regardless of how many callers race for it. */
  createOrGetByIdempotencyKey(
    tenantId: string,
    idempotencyRequestHash: Sha256Digest,
    build: () => PendingDecisionRecord
  ): Promise<DecisionRecord>;

  get(decisionId: string): Promise<DecisionRecord | undefined>;

  /** Compare-and-set: applies `next` only if the stored record's status is
   * still exactly `expectedCurrentStatus`, and only if that status is
   * followed by `next.status` in ALLOWED_DECISION_TRANSITIONS. Throws
   * ApiError('DECISION_STATE_CONFLICT') otherwise -- see
   * decision-repository.ts. */
  transition(decisionId: string, expectedCurrentStatus: DecisionStatus, next: DecisionRecord): Promise<DecisionRecord>;
}
