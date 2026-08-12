// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sha256Digest } from '@ddn/crypto';
import type { DecisionReceiptV1 } from '@ddn/receipt-sdk';
import { ApiError } from '../errors/api-error.js';
import { InMemoryDecisionRepository } from './decision-repository.js';
import type { DecisionRecord, PendingDecisionRecord } from './types.js';

const HASH_A = 'sha256:aaaa000000000000000000000000000000000000000000000000000000000000' as Sha256Digest;
const HASH_B = 'sha256:bbbb000000000000000000000000000000000000000000000000000000000000' as Sha256Digest;

function pendingRecord(decisionId: string, hash: Sha256Digest): PendingDecisionRecord {
  return {
    decisionId,
    tenantId: 'tenant-a',
    policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
    input: { vehicleId: 'v1' },
    verificationProfileId: 'default',
    idempotencyRequestHash: hash,
    submittedAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    status: 'PENDING',
  };
}

async function expectApiError(fn: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    return true;
  });
}

test('createOrGetByIdempotencyKey creates a new record on first call', async () => {
  const repo = new InMemoryDecisionRepository();
  let buildCalls = 0;
  const record = await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => {
    buildCalls += 1;
    return pendingRecord('dec_1', HASH_A);
  });
  assert.equal(buildCalls, 1);
  assert.equal(record.decisionId, 'dec_1');
});

test('createOrGetByIdempotencyKey returns the existing record instead of building a new one', async () => {
  const repo = new InMemoryDecisionRepository();
  await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => pendingRecord('dec_1', HASH_A));
  let buildCalls = 0;
  const second = await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => {
    buildCalls += 1;
    return pendingRecord('dec_2', HASH_A);
  });
  assert.equal(buildCalls, 0);
  assert.equal(second.decisionId, 'dec_1');
});

test('createOrGetByIdempotencyKey treats different tenants with the same hash as different keys', async () => {
  const repo = new InMemoryDecisionRepository();
  await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => pendingRecord('dec_1', HASH_A));
  const other = await repo.createOrGetByIdempotencyKey('tenant-b', HASH_A, () => pendingRecord('dec_2', HASH_A));
  assert.equal(other.decisionId, 'dec_2');
});

test('createOrGetByIdempotencyKey treats different hashes for the same tenant as different keys', async () => {
  const repo = new InMemoryDecisionRepository();
  await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => pendingRecord('dec_1', HASH_A));
  const other = await repo.createOrGetByIdempotencyKey('tenant-a', HASH_B, () => pendingRecord('dec_2', HASH_B));
  assert.equal(other.decisionId, 'dec_2');
});

test('transition succeeds for an allowed PENDING -> RUNNING move', async () => {
  const repo = new InMemoryDecisionRepository();
  await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => pendingRecord('dec_1', HASH_A));
  const running: DecisionRecord = { ...pendingRecord('dec_1', HASH_A), status: 'RUNNING' };
  const result = await repo.transition('dec_1', 'PENDING', running);
  assert.equal(result.status, 'RUNNING');
  assert.equal((await repo.get('dec_1'))?.status, 'RUNNING');
});

test('transition rejects an illegal PENDING -> FINALIZED jump', async () => {
  const repo = new InMemoryDecisionRepository();
  await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => pendingRecord('dec_1', HASH_A));
  const finalized: DecisionRecord = {
    ...pendingRecord('dec_1', HASH_A),
    status: 'FINALIZED',
    result: {},
    // The state-machine check happens before the receipt is ever read, so
    // an intentionally-fake receipt is fine here -- this test only cares
    // that the illegal transition itself is rejected.
    receipt: {} as DecisionReceiptV1,
    finalizedAt: '2026-08-03T00:00:01.000Z',
  };
  await expectApiError(() => repo.transition('dec_1', 'PENDING', finalized), 'DECISION_STATE_CONFLICT');
});

test('transition rejects when expectedCurrentStatus does not match the actual stored status', async () => {
  const repo = new InMemoryDecisionRepository();
  await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => pendingRecord('dec_1', HASH_A));
  const running: DecisionRecord = { ...pendingRecord('dec_1', HASH_A), status: 'RUNNING' };
  await expectApiError(() => repo.transition('dec_1', 'RUNNING', running), 'DECISION_STATE_CONFLICT');
});

test('transition rejects an unknown decisionId', async () => {
  const repo = new InMemoryDecisionRepository();
  const running: DecisionRecord = { ...pendingRecord('dec_missing', HASH_A), status: 'RUNNING' };
  await expectApiError(() => repo.transition('dec_missing', 'PENDING', running), 'DECISION_NOT_FOUND');
});

test('transition rejects moving out of a terminal state', async () => {
  const repo = new InMemoryDecisionRepository();
  await repo.createOrGetByIdempotencyKey('tenant-a', HASH_A, () => pendingRecord('dec_1', HASH_A));
  const running: DecisionRecord = { ...pendingRecord('dec_1', HASH_A), status: 'RUNNING' };
  await repo.transition('dec_1', 'PENDING', running);
  const failed: DecisionRecord = { ...pendingRecord('dec_1', HASH_A), status: 'FAILED', error: { code: 'X', message: 'x' } };
  await repo.transition('dec_1', 'RUNNING', failed);
  const rerun: DecisionRecord = { ...pendingRecord('dec_1', HASH_A), status: 'RUNNING' };
  await expectApiError(() => repo.transition('dec_1', 'FAILED', rerun), 'DECISION_STATE_CONFLICT');
});

test('get returns undefined for an unknown decisionId', async () => {
  const repo = new InMemoryDecisionRepository();
  assert.equal(await repo.get('dec_missing'), undefined);
});
