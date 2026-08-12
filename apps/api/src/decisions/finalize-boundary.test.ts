// SPDX-License-Identifier: Apache-2.0
// Milestone 6: fast, isolated unit tests for finalize.ts's rollback
// behavior -- no real validator binary needed, since these test the
// orchestration logic itself against a fake DecisionRepository, not the
// real decision pipeline (that's finalize.test.ts's job).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sha256Digest } from '@ddn/crypto';
import type { DecisionReceiptV1 } from '@ddn/receipt-sdk';
import { AnchorSidecarStore } from '@ddn/anchor-service';
import { finalizeDecisionAndMarkEligible } from './finalize.js';
import type { DecisionRecord, DecisionRepository, FinalizedDecisionRecord, PendingDecisionRecord } from './types.js';

function sha(byte: string): Sha256Digest {
  return `sha256:${byte.repeat(32)}` as Sha256Digest;
}

function fakeFinalizedRecord(decisionId: string, tenantId: string, receiptId: Sha256Digest): FinalizedDecisionRecord {
  return {
    decisionId,
    tenantId,
    policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
    input: {},
    verificationProfileId: 'ddn-wasm-v1',
    idempotencyRequestHash: sha('idempotency'),
    submittedAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:01.000Z',
    status: 'FINALIZED',
    result: {},
    receipt: { receiptId } as DecisionReceiptV1,
    finalizedAt: '2026-08-03T00:00:01.000Z',
  };
}

/** Always rejects the RUNNING -> FINALIZED transition, simulating an
 * (in normal operation, unreachable) decision-repository failure after
 * markEligible has already run. */
class RejectingDecisionRepository implements DecisionRepository {
  async createOrGetByIdempotencyKey(_tenantId: string, _hash: Sha256Digest, build: () => PendingDecisionRecord): Promise<DecisionRecord> {
    return build();
  }
  async get(): Promise<DecisionRecord | undefined> {
    return undefined;
  }
  async transition(): Promise<DecisionRecord> {
    throw new Error('forced transition rejection for test');
  }
}

test('a forced transition rejection rolls back the eligibility entry THIS call just created', async () => {
  const sidecarStore = new AnchorSidecarStore();
  const receiptId = sha('a');
  const finalized = fakeFinalizedRecord('dec_1', 'tenant-a', receiptId);

  await assert.rejects(
    () => finalizeDecisionAndMarkEligible(new RejectingDecisionRepository(), sidecarStore, 'dec_1', finalized),
    /forced transition rejection/
  );

  assert.equal(sidecarStore.getByReceiptId(receiptId), undefined, 'the entry this call created must be rolled back');
  assert.equal(sidecarStore.getByDecisionId('dec_1'), undefined);
});

test('a forced transition rejection does NOT remove a pre-existing idempotent eligibility entry', async () => {
  const sidecarStore = new AnchorSidecarStore();
  const receiptId = sha('b');
  const finalized = fakeFinalizedRecord('dec_2', 'tenant-a', receiptId);

  // Simulate an entry that already existed before this finalization
  // attempt (e.g. from an earlier, already-legitimate call) -- markEligible
  // is idempotent, so the upcoming call inside finalizeDecisionAndMarkEligible
  // will see it and return false (no-op), not insert a new one.
  sidecarStore.markEligible(finalized.decisionId, finalized.tenantId, receiptId, finalized.receipt);
  assert.ok(sidecarStore.getByReceiptId(receiptId), 'precondition: the entry already exists');

  await assert.rejects(
    () => finalizeDecisionAndMarkEligible(new RejectingDecisionRepository(), sidecarStore, 'dec_2', finalized),
    /forced transition rejection/
  );

  const entry = sidecarStore.getByReceiptId(receiptId);
  assert.ok(entry, 'a pre-existing entry must survive a later transition rejection for the same receiptId');
  assert.equal(entry.status, 'ELIGIBLE');
});

test('a successful transition never triggers a rollback', async () => {
  const sidecarStore = new AnchorSidecarStore();
  const receiptId = sha('c');
  const finalized = fakeFinalizedRecord('dec_3', 'tenant-a', receiptId);

  class AcceptingDecisionRepository implements DecisionRepository {
    async createOrGetByIdempotencyKey(_tenantId: string, _hash: Sha256Digest, build: () => PendingDecisionRecord): Promise<DecisionRecord> {
      return build();
    }
    async get(): Promise<DecisionRecord | undefined> {
      return undefined;
    }
    async transition(): Promise<DecisionRecord> {
      return finalized;
    }
  }

  const result = await finalizeDecisionAndMarkEligible(new AcceptingDecisionRepository(), sidecarStore, 'dec_3', finalized);
  assert.equal(result, finalized);
  assert.equal(sidecarStore.getByReceiptId(receiptId)?.status, 'ELIGIBLE');
});
