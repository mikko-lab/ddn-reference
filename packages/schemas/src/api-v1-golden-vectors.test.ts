// SPDX-License-Identifier: Apache-2.0
// Contract tests: every committed golden vector under
// packages/test-vectors/vectors/api-v1/ must still parse cleanly through
// the live parse functions in api-v1.ts. These vectors are the reference
// examples referenced by docs/api-v1.md and consumed by @ddn/client-sdk's
// own tests (packages/client-sdk/src/submit-wait-and-verify.test.ts uses
// the sibling decision-receipt-v1 vectors the same way) -- a schema
// change that breaks one of these is a breaking API change, not just an
// internal refactor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseApiErrorResponseV1,
  parseDecisionStatusResponseV1,
  parsePolicyListResponseV1,
  parseSubmitDecisionRequestV1,
  parseVerifyReceiptRequestV1,
  parseVerifyReceiptResponseV1,
} from './api-v1.js';

const VECTORS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../test-vectors/vectors/api-v1');

function readVector(filename: string): unknown {
  return JSON.parse(readFileSync(join(VECTORS_DIR, filename), 'utf8'));
}

test('golden vector: submit-decision-request.json parses as SubmitDecisionRequestV1', () => {
  const parsed = parseSubmitDecisionRequestV1(readVector('submit-decision-request.json'));
  assert.equal(parsed.policy.policyId, 'negotiation-v1');
  assert.equal(parsed.verificationProfileId, 'ddn-wasm-v1');
});

test('golden vector: decision-status-response-pending.json parses as a PENDING DecisionStatusResponseV1', () => {
  const parsed = parseDecisionStatusResponseV1(readVector('decision-status-response-pending.json'));
  assert.equal(parsed.status, 'PENDING');
});

test('golden vector: decision-status-response-finalized.json parses as a FINALIZED DecisionStatusResponseV1', () => {
  const parsed = parseDecisionStatusResponseV1(readVector('decision-status-response-finalized.json'));
  assert.equal(parsed.status, 'FINALIZED');
  if (parsed.status === 'FINALIZED') {
    assert.equal(parsed.verification.matchingValidators, 3);
    assert.equal(parsed.verification.requiredQuorum, 2);
  }
});

test('golden vector: decision-status-response-no-quorum.json parses as a NO_QUORUM DecisionStatusResponseV1', () => {
  const parsed = parseDecisionStatusResponseV1(readVector('decision-status-response-no-quorum.json'));
  assert.equal(parsed.status, 'NO_QUORUM');
});

test('golden vector: verify-receipt-request.json parses as VerifyReceiptRequestV1', () => {
  const parsed = parseVerifyReceiptRequestV1(readVector('verify-receipt-request.json'));
  assert.equal(parsed.schemaVersion, '1.0.0');
});

test('golden vector: verify-receipt-response-valid.json parses as a VALID VerifyReceiptResponseV1', () => {
  const parsed = parseVerifyReceiptResponseV1(readVector('verify-receipt-response-valid.json'));
  assert.equal(parsed.status, 'VALID');
  assert.ok(parsed.checks.every((c) => c.passed));
});

test('golden vector: policy-list-response.json parses as PolicyListResponseV1', () => {
  const parsed = parsePolicyListResponseV1(readVector('policy-list-response.json'));
  assert.equal(parsed.policies.length, 1);
  assert.equal(parsed.policies[0]?.policyId, 'negotiation-v1');
});

test('golden vector: api-error-response.json parses as ApiErrorResponseV1', () => {
  const parsed = parseApiErrorResponseV1(readVector('api-error-response.json'));
  assert.equal(parsed.error.code, 'TENANT_MISMATCH');
});
