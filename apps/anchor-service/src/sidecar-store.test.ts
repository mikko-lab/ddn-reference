// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sha256Digest } from '@ddn/crypto';
import type { AnchorRecordV1, DecisionReceiptV1 } from '@ddn/receipt-sdk';
import { AnchorSidecarError, AnchorSidecarStore } from './sidecar-store.js';

function sha(byte: string): Sha256Digest {
  return `sha256:${byte.repeat(32)}` as Sha256Digest;
}

const FAKE_RECEIPT = {} as DecisionReceiptV1; // sidecar store never inspects receipt content, just holds it

function fakeAnchorRecord(receiptId: Sha256Digest, batchId: Sha256Digest, blockNumber: number): AnchorRecordV1 {
  return {
    schemaVersion: '1.0.0',
    receiptId,
    batchId,
    merkleRoot: sha('root'),
    proof: { leafHash: receiptId, leafIndex: 0, siblings: [], totalLeaves: 1 },
    chain: { chainId: 31337, contractAddress: '0x' + '0'.repeat(40) },
    confirmation: { txHash: '0x' + '1'.repeat(64), blockNumber, blockHash: '0x' + '2'.repeat(64), confirmedAt: '2026-08-03T00:00:00.000Z' },
  };
}

test('markEligible is idempotent per receiptId', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  assert.equal(store.listEligible(10).length, 1);
});

test('listEligible respects the limit and only returns ELIGIBLE entries', () => {
  const store = new AnchorSidecarStore();
  const ids = [sha('a'), sha('b'), sha('c')];
  for (const [i, id] of ids.entries()) store.markEligible(`dec_${i}`, 'tenant-a', id, FAKE_RECEIPT);
  store.markBatched([ids[0]!], sha('batch'));
  const eligible = store.listEligible(10);
  assert.equal(eligible.length, 2);
  assert.ok(!eligible.some((e) => e.receiptId === ids[0]));
});

test('full happy path: ELIGIBLE -> BATCHED -> SUBMITTED -> CONFIRMED', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  assert.equal(store.getByReceiptId(id)?.status, 'ELIGIBLE');

  const batchId = sha('batch');
  store.markBatched([id], batchId);
  assert.equal(store.getByReceiptId(id)?.status, 'BATCHED');
  assert.equal(store.getByReceiptId(id)?.batchId, batchId);

  store.markSubmitted([id], '0xabc');
  assert.equal(store.getByReceiptId(id)?.status, 'SUBMITTED');
  assert.equal(store.getByReceiptId(id)?.txHash, '0xabc');

  const record = fakeAnchorRecord(id, batchId, 10);
  store.markConfirmed(id, record);
  const confirmed = store.getByReceiptId(id);
  assert.equal(confirmed?.status, 'CONFIRMED');
  assert.deepEqual(confirmed?.anchorRecord, record);
});

test('getByDecisionId resolves through the receiptId index', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  assert.equal(store.getByDecisionId('dec_1')?.receiptId, id);
  assert.equal(store.getByDecisionId('dec_unknown'), undefined);
});

test('markRetryableFailure returns an entry to ELIGIBLE below the retry ceiling', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  store.markBatched([id], sha('batch'));
  store.markSubmitted([id], '0xabc');

  store.markRetryableFailure(id, 'transaction reverted');
  const entry = store.getByReceiptId(id);
  assert.equal(entry?.status, 'ELIGIBLE');
  assert.equal(entry?.retryCount, 1);
  assert.equal(entry?.batchId, undefined);
  assert.equal(entry?.txHash, undefined);
  assert.equal(entry?.lastError, 'transaction reverted');
});

test('markRetryableFailure moves to the terminal ANCHOR_FAILED after enough retries', () => {
  // Mirrors how the worker actually reaches markRetryableFailure: an entry
  // is re-batched (ELIGIBLE -> BATCHED) before each attempt, matching
  // worker.ts's own submitEligibleBatch/checkSubmittedConfirmations call
  // sites -- markRetryableFailure is never called directly on a bare
  // ELIGIBLE entry in real usage, and the store now rejects that (ELIGIBLE
  // is not a legal source for it).
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  for (let i = 0; i < 4; i++) {
    store.markBatched([id], sha(`batch-${i}`));
    store.markRetryableFailure(id, `attempt ${i}`);
    assert.equal(store.getByReceiptId(id)?.status, 'ELIGIBLE');
  }
  store.markBatched([id], sha('batch-final'));
  store.markRetryableFailure(id, 'final attempt');
  const entry = store.getByReceiptId(id);
  assert.equal(entry?.status, 'ANCHOR_FAILED');
  assert.equal(entry?.retryCount, 5);
});

test('markReorgPending transitions a CONFIRMED entry out of CONFIRMED', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  store.markBatched([id], sha('batch'));
  store.markSubmitted([id], '0xabc');
  store.markConfirmed(id, fakeAnchorRecord(id, sha('batch'), 10));
  store.markReorgPending(id);
  assert.equal(store.getByReceiptId(id)?.status, 'REORG_PENDING');
});

test('listSubmittedByBatch groups multiple entries sharing a batchId', () => {
  const store = new AnchorSidecarStore();
  const ids = [sha('a'), sha('b')];
  const batchId = sha('shared-batch');
  for (const [i, id] of ids.entries()) store.markEligible(`dec_${i}`, 'tenant-a', id, FAKE_RECEIPT);
  store.markBatched(ids, batchId);
  store.markSubmitted(ids, '0xabc');
  const grouped = store.listSubmittedByBatch().get(batchId);
  assert.equal(grouped?.length, 2);
});

test('listConfirmedByBlock groups entries sharing (batchId, blockNumber)', () => {
  const store = new AnchorSidecarStore();
  const ids = [sha('a'), sha('b')];
  const batchId = sha('shared-batch');
  for (const [i, id] of ids.entries()) {
    store.markEligible(`dec_${i}`, 'tenant-a', id, FAKE_RECEIPT);
  }
  store.markBatched(ids, batchId);
  store.markSubmitted(ids, '0xabc');
  for (const id of ids) store.markConfirmed(id, fakeAnchorRecord(id, batchId, 99));
  const key = `${batchId}:99`;
  assert.equal(store.listConfirmedByBlock().get(key)?.length, 2);
});

// --- explicit transition validation: unknown receiptId, wrong starting
// state, and illegal targets must all throw, never silently no-op ---

test('markBatched throws AnchorSidecarError(UNKNOWN_RECEIPT_ID) for a receiptId the store has never seen', () => {
  const store = new AnchorSidecarStore();
  assert.throws(() => store.markBatched([sha('never-tracked')], sha('batch')), (error: unknown) => {
    assert.ok(error instanceof AnchorSidecarError);
    assert.equal(error.code, 'UNKNOWN_RECEIPT_ID');
    return true;
  });
});

test('markConfirmed throws AnchorSidecarError(ILLEGAL_TRANSITION) from ELIGIBLE (wrong starting state, skipping BATCHED/SUBMITTED)', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  assert.throws(() => store.markConfirmed(id, fakeAnchorRecord(id, sha('batch'), 1)), (error: unknown) => {
    assert.ok(error instanceof AnchorSidecarError);
    assert.equal(error.code, 'ILLEGAL_TRANSITION');
    return true;
  });
  assert.equal(store.getByReceiptId(id)?.status, 'ELIGIBLE', 'a rejected transition must not mutate the entry');
});

test('markSubmitted throws ILLEGAL_TRANSITION from ELIGIBLE (skipping BATCHED)', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  assert.throws(() => store.markSubmitted([id], '0xabc'), AnchorSidecarError);
  assert.equal(store.getByReceiptId(id)?.status, 'ELIGIBLE');
});

test('markBatched throws ILLEGAL_TRANSITION from CONFIRMED', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  store.markBatched([id], sha('batch'));
  store.markSubmitted([id], '0xabc');
  store.markConfirmed(id, fakeAnchorRecord(id, sha('batch'), 1));
  assert.throws(() => store.markBatched([id], sha('batch2')), AnchorSidecarError);
  assert.equal(store.getByReceiptId(id)?.status, 'CONFIRMED');
});

test('every method rejects a transition attempted from the terminal ANCHOR_FAILED state', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  for (let i = 0; i < 5; i++) {
    store.markBatched([id], sha(`batch-${i}`));
    store.markRetryableFailure(id, `attempt ${i}`);
  }
  assert.equal(store.getByReceiptId(id)?.status, 'ANCHOR_FAILED');

  assert.throws(() => store.markBatched([id], sha('batch')), AnchorSidecarError);
  assert.throws(() => store.markSubmitted([id], '0xabc'), AnchorSidecarError);
  assert.throws(() => store.markConfirmed(id, fakeAnchorRecord(id, sha('batch'), 1)), AnchorSidecarError);
  assert.throws(() => store.markReorgPending(id), AnchorSidecarError);
  assert.throws(() => store.markRetryableFailure(id, 'still failing'), AnchorSidecarError);
  assert.equal(store.getByReceiptId(id)?.status, 'ANCHOR_FAILED', 'no rejected attempt may have mutated the entry');
});

test('markReorgPending throws ILLEGAL_TRANSITION from ELIGIBLE and from BATCHED', () => {
  const store = new AnchorSidecarStore();
  const eligibleId = sha('a');
  store.markEligible('dec_1', 'tenant-a', eligibleId, FAKE_RECEIPT);
  assert.throws(() => store.markReorgPending(eligibleId), AnchorSidecarError);

  const batchedId = sha('b');
  store.markEligible('dec_2', 'tenant-a', batchedId, FAKE_RECEIPT);
  store.markBatched([batchedId], sha('batch'));
  assert.throws(() => store.markReorgPending(batchedId), AnchorSidecarError);
});

test('markRetryableFailure throws UNKNOWN_RECEIPT_ID for an untracked receiptId', () => {
  const store = new AnchorSidecarStore();
  assert.throws(() => store.markRetryableFailure(sha('never-tracked'), 'reason'), (error: unknown) => {
    assert.ok(error instanceof AnchorSidecarError);
    assert.equal(error.code, 'UNKNOWN_RECEIPT_ID');
    return true;
  });
});

test('markBatched validates every receiptId before mutating any of them (all-or-nothing)', () => {
  const store = new AnchorSidecarStore();
  const goodId = sha('a');
  const untrackedId = sha('never-tracked');
  store.markEligible('dec_1', 'tenant-a', goodId, FAKE_RECEIPT);

  assert.throws(() => store.markBatched([goodId, untrackedId], sha('batch')), AnchorSidecarError);
  // goodId must be untouched -- the whole call rejected before any write happened.
  assert.equal(store.getByReceiptId(goodId)?.status, 'ELIGIBLE');
});

test('a decision belonging to a different tenant is still retrievable by receiptId (tenant isolation is the API route\'s job, not the store\'s)', () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);
  assert.equal(store.getByReceiptId(id)?.tenantId, 'tenant-a');
});
