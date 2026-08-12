// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIdempotencyRequestHash } from './idempotency.js';

const BASE = {
  tenantId: 'tenant-a',
  policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
  input: { vehicleId: 'v1', customerOfferCents: 1_000 },
  verificationProfileId: 'default',
};

test('computeIdempotencyRequestHash is deterministic for identical input', () => {
  assert.equal(computeIdempotencyRequestHash(BASE), computeIdempotencyRequestHash(BASE));
});

test('computeIdempotencyRequestHash is insensitive to input key order', () => {
  const reordered = { ...BASE, input: { customerOfferCents: 1_000, vehicleId: 'v1' } };
  assert.equal(computeIdempotencyRequestHash(BASE), computeIdempotencyRequestHash(reordered));
});

test('computeIdempotencyRequestHash differs when tenantId differs', () => {
  assert.notEqual(computeIdempotencyRequestHash(BASE), computeIdempotencyRequestHash({ ...BASE, tenantId: 'tenant-b' }));
});

test('computeIdempotencyRequestHash differs when policy differs', () => {
  const differentPolicy = { ...BASE, policy: { policyId: 'negotiation-v1', policyVersion: '2.0.0' } };
  assert.notEqual(computeIdempotencyRequestHash(BASE), computeIdempotencyRequestHash(differentPolicy));
});

test('computeIdempotencyRequestHash differs when input differs', () => {
  const differentInput = { ...BASE, input: { ...BASE.input, customerOfferCents: 2_000 } };
  assert.notEqual(computeIdempotencyRequestHash(BASE), computeIdempotencyRequestHash(differentInput));
});

test('computeIdempotencyRequestHash differs when verificationProfileId differs', () => {
  assert.notEqual(
    computeIdempotencyRequestHash(BASE),
    computeIdempotencyRequestHash({ ...BASE, verificationProfileId: 'strict' })
  );
});

test('computeIdempotencyRequestHash has the sha256: prefix', () => {
  assert.match(computeIdempotencyRequestHash(BASE), /^sha256:[0-9a-f]{64}$/);
});
