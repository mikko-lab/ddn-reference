// SPDX-License-Identifier: Apache-2.0
// Milestone 6: the one synchronous local finalization boundary tying a
// decision's RUNNING -> FINALIZED transition to its anchor-eligibility
// marking.
//
// This is deliberately NOT `await transition(); enqueue();` -- that reads
// as one atomic step but isn't one: transition() returns a Promise, and an
// `await` on it always yields to the microtask queue at least once even
// though InMemoryDecisionRepository's own transition() body never awaits
// internally (see decision-repository.ts's header comment). A second,
// separately-awaited call afterwards leaves a real gap where nothing
// guarantees the two writes happen together.
//
// Instead: anchor eligibility is marked FIRST, synchronously, with no
// `await` before it. AnchorSidecarStore.markEligible is a plain Map write
// with no `await` inside it either, so if it throws, `transition` below is
// never called at all -- a decision can never reach FINALIZED without
// first having been marked ELIGIBLE. If it does NOT throw, `transition` is
// invoked in that same synchronous turn, immediately after, before any
// `await` -- nothing else can interleave between the two writes.
//
// The reverse direction is closed too: if markEligible succeeds but the
// subsequent transition() rejects (an illegal/conflicting state -- not
// expected in normal operation, since routes.ts only ever invokes this once
// per decisionId, but not assumed away either), the eligibility entry this
// exact call just created is rolled back, so no ELIGIBLE sidecar entry is
// left for a decision that never actually reached FINALIZED. Only the
// entry THIS call created is ever removed: markEligible's own return value
// (true only if it inserted a new entry, false if one already existed) is
// what gates the rollback, so a pre-existing idempotent entry -- e.g. from
// an earlier, already-legitimate finalization -- is never touched.
//
// This is in-process atomicity only, not a durable transaction: it holds
// because both stores are synchronous, in-memory, and share this process
// (see AnchorSidecarStore's and InMemoryDecisionRepository's own header
// comments). A repository or sidecar store that ever performs real I/O
// here would break this guarantee and needs its own mechanism -- out of
// scope for Milestone 6's "strictly local" cross-process-handoff design.

import type { Sha256Digest } from '@ddn/crypto';
import type { DecisionReceiptV1 } from '@ddn/receipt-sdk';
import type { DecisionRecord, DecisionRepository, FinalizedDecisionRecord } from './types.js';

/** The two methods this boundary needs from the anchor sidecar -- narrower
 * than the full AnchorSidecarStore class, so a test can substitute a fake
 * (including one that throws) without needing a real store instance. */
export interface AnchorEligibilityMarker {
  /** Returns true if this call inserted a new ELIGIBLE entry, false if one
   * already existed (idempotent no-op). */
  markEligible(decisionId: string, tenantId: string, receiptId: Sha256Digest, receipt: DecisionReceiptV1): boolean;
  /** Removes the entry for receiptId only if it is still untouched in
   * ELIGIBLE -- safe to call only when the caller knows it was the one
   * that just created it (see markEligible's return value). A no-op if the
   * entry has already moved on or doesn't exist. */
  rollbackJustCreatedEligibility(receiptId: Sha256Digest): void;
}

export async function finalizeDecisionAndMarkEligible(
  decisionRepository: DecisionRepository,
  sidecarStore: AnchorEligibilityMarker,
  decisionId: string,
  finalized: FinalizedDecisionRecord
): Promise<DecisionRecord> {
  // No `await` between this call and the next -- see this file's header.
  const insertedNewEligibility = sidecarStore.markEligible(
    finalized.decisionId,
    finalized.tenantId,
    finalized.receipt.receiptId,
    finalized.receipt
  );
  try {
    return await decisionRepository.transition(decisionId, 'RUNNING', finalized);
  } catch (error) {
    if (insertedNewEligibility) {
      sidecarStore.rollbackJustCreatedEligibility(finalized.receipt.receiptId);
    }
    throw error;
  }
}
