// SPDX-License-Identifier: Apache-2.0
// Milestone 6: the anchor sidecar's state machine, entirely separate from
// DecisionStatus (PENDING/RUNNING/FINALIZED/NO_QUORUM/FAILED, unchanged --
// see apps/api's decisions/types.ts). Anchoring is decoupled from decision
// finality (ADR-001); this store is what tracks it.
//
//   ELIGIBLE -> BATCHED -> SUBMITTED -> CONFIRMED
//                              |            |
//                        (revert/drop) (blockHash mismatch at blockNumber)
//                              v            v
//                          ELIGIBLE <- REORG_PENDING -> CONFIRMED
//                                      (re-fetch getBatch: genuinely
//                                       dropped -> re-batch fresh;
//                                       actually landed -> refreshed
//                                       block evidence)
//
// After a bounded number of retries, a batch's entries move to the
// terminal ANCHOR_FAILED instead of retrying forever.
//
// Every status change is validated against ALLOWED_ANCHOR_TRANSITIONS below,
// mirroring apps/api's own ALLOWED_DECISION_TRANSITIONS discipline exactly:
// an unknown receiptId, a transition attempted from a status that doesn't
// permit it, or a target status not reachable from the current one all
// throw AnchorSidecarError rather than silently no-opping. A bug in the
// worker's own call sequence must fail loudly here, not corrupt state
// quietly.
//
// In-memory only -- same process, same lifetime, same non-durability
// profile as apps/api's own InMemoryDecisionRepository (Milestone 5). An
// apps/api restart loses all sidecar state exactly as it already loses all
// decision state; this introduces no new loss. See the Milestone 6
// "strictly local" cross-process-handoff design. Durable multi-instance
// operation is explicitly out of scope.

import type { Sha256Digest } from '@ddn/crypto';
import type { AnchorRecordV1, DecisionReceiptV1 } from '@ddn/receipt-sdk';

export type AnchorSidecarStatus = 'ELIGIBLE' | 'BATCHED' | 'SUBMITTED' | 'CONFIRMED' | 'REORG_PENDING' | 'ANCHOR_FAILED';

export type AnchorSidecarErrorCode = 'UNKNOWN_RECEIPT_ID' | 'ILLEGAL_TRANSITION';

export class AnchorSidecarError extends Error {
  readonly code: AnchorSidecarErrorCode;
  constructor(code: AnchorSidecarErrorCode, message: string) {
    super(message);
    this.name = 'AnchorSidecarError';
    this.code = code;
  }
}

/** The only transitions this store permits -- see the diagram above.
 * ANCHOR_FAILED is terminal. Checked by every status-changing method;
 * see requireTransition below. */
export const ALLOWED_ANCHOR_TRANSITIONS: Record<AnchorSidecarStatus, readonly AnchorSidecarStatus[]> = {
  ELIGIBLE: ['BATCHED'],
  BATCHED: ['SUBMITTED', 'ELIGIBLE', 'ANCHOR_FAILED'],
  SUBMITTED: ['CONFIRMED', 'REORG_PENDING', 'ELIGIBLE', 'ANCHOR_FAILED'],
  REORG_PENDING: ['CONFIRMED', 'ELIGIBLE', 'ANCHOR_FAILED'],
  CONFIRMED: ['REORG_PENDING'],
  ANCHOR_FAILED: [],
};

export interface AnchorSidecarEntry {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly receiptId: Sha256Digest;
  readonly receipt: DecisionReceiptV1;
  readonly status: AnchorSidecarStatus;
  readonly batchId?: Sha256Digest | undefined;
  readonly txHash?: string | undefined;
  readonly retryCount: number;
  readonly anchorRecord?: AnchorRecordV1 | undefined;
  /** Server-side diagnostic only -- never surface this raw to a client;
   * GET /v1/decisions/{id}/anchor responds 409 ANCHOR_NOT_AVAILABLE for
   * every non-CONFIRMED status regardless of what this holds (a 404 is
   * reserved for a decisionId the caller's tenant doesn't own at all). */
  readonly lastError?: string | undefined;
}

const MAX_RETRIES = 5;

export class AnchorSidecarStore {
  private readonly byReceiptId = new Map<Sha256Digest, AnchorSidecarEntry>();
  private readonly receiptIdByDecisionId = new Map<string, Sha256Digest>();

  /** Idempotent: a receiptId already tracked is left untouched. Returns
   * `true` if this call actually inserted a new entry, `false` if one
   * already existed (a no-op) -- the synchronous local finalization
   * boundary in apps/api's decisions/finalize.ts uses this return value to
   * know whether it's safe to roll this entry back if the paired
   * decision-repository transition then fails; see that file for why it
   * must run with no `await` between the RUNNING -> FINALIZED transition
   * and this call. */
  markEligible(decisionId: string, tenantId: string, receiptId: Sha256Digest, receipt: DecisionReceiptV1): boolean {
    if (this.byReceiptId.has(receiptId)) return false;
    this.byReceiptId.set(receiptId, { decisionId, tenantId, receiptId, receipt, status: 'ELIGIBLE', retryCount: 0 });
    this.receiptIdByDecisionId.set(decisionId, receiptId);
    return true;
  }

  /** Rolls back a receiptId's eligibility entry, but only if it is still
   * sitting untouched in ELIGIBLE -- i.e. only ever safe to call on an
   * entry a caller knows *it itself* just created via markEligible
   * returning true. Never touches an entry that pre-existed (which might
   * be the result of a separate, already-legitimate finalization) or one
   * the worker has already progressed past ELIGIBLE. A no-op, not an
   * error, if the entry has moved on or doesn't exist -- this is a
   * best-effort cleanup, not a transition whose absence should itself be
   * loud. */
  rollbackJustCreatedEligibility(receiptId: Sha256Digest): void {
    const current = this.byReceiptId.get(receiptId);
    if (current?.status !== 'ELIGIBLE') return;
    this.byReceiptId.delete(receiptId);
    if (this.receiptIdByDecisionId.get(current.decisionId) === receiptId) {
      this.receiptIdByDecisionId.delete(current.decisionId);
    }
  }

  listEligible(limit: number): readonly AnchorSidecarEntry[] {
    const out: AnchorSidecarEntry[] = [];
    for (const entry of this.byReceiptId.values()) {
      if (entry.status !== 'ELIGIBLE') continue;
      out.push(entry);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Throws AnchorSidecarError('UNKNOWN_RECEIPT_ID', ...) if no entry
   * exists, or ('ILLEGAL_TRANSITION', ...) if the entry's current status
   * doesn't permit moving to `next` -- never silently no-ops either way. */
  private requireTransition(receiptId: Sha256Digest, next: AnchorSidecarStatus): AnchorSidecarEntry {
    const current = this.byReceiptId.get(receiptId);
    if (!current) {
      throw new AnchorSidecarError('UNKNOWN_RECEIPT_ID', `no anchor sidecar entry exists for receiptId: ${receiptId}`);
    }
    if (!ALLOWED_ANCHOR_TRANSITIONS[current.status].includes(next)) {
      throw new AnchorSidecarError(
        'ILLEGAL_TRANSITION',
        `illegal anchor sidecar transition for receiptId ${receiptId}: ${current.status} -> ${next}`
      );
    }
    return current;
  }

  private apply(entry: AnchorSidecarEntry, next: AnchorSidecarStatus, patch: Partial<AnchorSidecarEntry>): void {
    this.byReceiptId.set(entry.receiptId, { ...entry, ...patch, status: next });
  }

  /** Validates every receiptId (throwing before mutating any of them if
   * one is invalid) so a batch-wide call is all-or-nothing, never
   * partially applied. */
  markBatched(receiptIds: readonly Sha256Digest[], batchId: Sha256Digest): void {
    const entries = receiptIds.map((id) => this.requireTransition(id, 'BATCHED'));
    for (const entry of entries) this.apply(entry, 'BATCHED', { batchId });
  }

  markSubmitted(receiptIds: readonly Sha256Digest[], txHash: string): void {
    const entries = receiptIds.map((id) => this.requireTransition(id, 'SUBMITTED'));
    for (const entry of entries) this.apply(entry, 'SUBMITTED', { txHash });
  }

  markConfirmed(receiptId: Sha256Digest, anchorRecord: AnchorRecordV1): void {
    const entry = this.requireTransition(receiptId, 'CONFIRMED');
    this.apply(entry, 'CONFIRMED', { anchorRecord, lastError: undefined });
  }

  markReorgPending(receiptId: Sha256Digest): void {
    const entry = this.requireTransition(receiptId, 'REORG_PENDING');
    this.apply(entry, 'REORG_PENDING', {});
  }

  /** A batch genuinely dropped (reverted, never mined, or a reorg that
   * didn't resolve back to confirmed) returns to ELIGIBLE for rebatching --
   * since batchId is purely content-derived (no sequence counter), a fresh
   * batch built from the still-eligible entries is either identical to the
   * dropped one (safe, idempotent resubmission) or a superset including
   * newly-finalized decisions (strictly better batching), never a
   * duplicate-count risk. After MAX_RETRIES, moves to the terminal
   * ANCHOR_FAILED instead of retrying forever. */
  markRetryableFailure(receiptId: Sha256Digest, reason: string): void {
    const current = this.byReceiptId.get(receiptId);
    if (!current) {
      throw new AnchorSidecarError('UNKNOWN_RECEIPT_ID', `no anchor sidecar entry exists for receiptId: ${receiptId}`);
    }
    const retryCount = current.retryCount + 1;
    if (retryCount >= MAX_RETRIES) {
      const entry = this.requireTransition(receiptId, 'ANCHOR_FAILED');
      this.apply(entry, 'ANCHOR_FAILED', { retryCount, lastError: reason });
      console.error(`anchor sidecar: receiptId ${receiptId} permanently failed after ${retryCount} attempts: ${reason}`);
      return;
    }
    const entry = this.requireTransition(receiptId, 'ELIGIBLE');
    this.apply(entry, 'ELIGIBLE', { retryCount, lastError: reason, batchId: undefined, txHash: undefined });
  }

  getByReceiptId(receiptId: Sha256Digest): AnchorSidecarEntry | undefined {
    return this.byReceiptId.get(receiptId);
  }

  getByDecisionId(decisionId: string): AnchorSidecarEntry | undefined {
    const receiptId = this.receiptIdByDecisionId.get(decisionId);
    return receiptId ? this.byReceiptId.get(receiptId) : undefined;
  }

  /** SUBMITTED entries grouped by batchId, for the worker's confirmation pass. */
  listSubmittedByBatch(): ReadonlyMap<Sha256Digest, readonly AnchorSidecarEntry[]> {
    const out = new Map<Sha256Digest, AnchorSidecarEntry[]>();
    for (const entry of this.byReceiptId.values()) {
      if (entry.status !== 'SUBMITTED' || !entry.batchId) continue;
      const list = out.get(entry.batchId) ?? [];
      list.push(entry);
      out.set(entry.batchId, list);
    }
    return out;
  }

  /** CONFIRMED entries grouped by (batchId, blockNumber), for periodic
   * reorg re-checks against the current chain head. */
  listConfirmedByBlock(): ReadonlyMap<string, readonly AnchorSidecarEntry[]> {
    const out = new Map<string, AnchorSidecarEntry[]>();
    for (const entry of this.byReceiptId.values()) {
      if (entry.status !== 'CONFIRMED' || !entry.anchorRecord) continue;
      const key = `${entry.anchorRecord.batchId}:${entry.anchorRecord.confirmation.blockNumber}`;
      const list = out.get(key) ?? [];
      list.push(entry);
      out.set(key, list);
    }
    return out;
  }

  /** REORG_PENDING entries grouped by batchId, for reorg resolution. */
  listReorgPendingByBatch(): ReadonlyMap<Sha256Digest, readonly AnchorSidecarEntry[]> {
    const out = new Map<Sha256Digest, AnchorSidecarEntry[]>();
    for (const entry of this.byReceiptId.values()) {
      if (entry.status !== 'REORG_PENDING' || !entry.batchId) continue;
      const list = out.get(entry.batchId) ?? [];
      list.push(entry);
      out.set(entry.batchId, list);
    }
    return out;
  }
}
