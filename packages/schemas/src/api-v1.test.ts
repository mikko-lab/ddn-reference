// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiSchemaValidationError,
  parseApiErrorResponseV1,
  parseDecisionStatusResponseV1,
  parseGetAnchorResponseV1,
  parsePolicyDetailResponseV1,
  parsePolicyListResponseV1,
  parseSubmitDecisionRequestV1,
  parseValidatorProgressResponseV1,
  parseVerifyReceiptRequestV1,
  parseVerifyReceiptResponseV1,
} from './api-v1.js';

const VALID_SUBMIT_REQUEST = {
  schemaVersion: '1.0.0',
  policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
  input: { vehicleId: 'v1', customerOfferCents: 1000 },
  verificationProfileId: 'ddn-wasm-v1',
};

test('parseSubmitDecisionRequestV1 accepts a well-formed request', () => {
  const parsed = parseSubmitDecisionRequestV1(VALID_SUBMIT_REQUEST);
  assert.deepEqual(parsed, VALID_SUBMIT_REQUEST);
});

test('parseSubmitDecisionRequestV1 rejects an unknown top-level field', () => {
  assert.throws(() => parseSubmitDecisionRequestV1({ ...VALID_SUBMIT_REQUEST, extra: 'x' }), ApiSchemaValidationError);
});

test('parseSubmitDecisionRequestV1 rejects a missing policy', () => {
  const rest: Record<string, unknown> = { ...VALID_SUBMIT_REQUEST };
  delete rest.policy;
  assert.throws(() => parseSubmitDecisionRequestV1(rest), ApiSchemaValidationError);
});

test('parseSubmitDecisionRequestV1 rejects a wrong schemaVersion', () => {
  assert.throws(() => parseSubmitDecisionRequestV1({ ...VALID_SUBMIT_REQUEST, schemaVersion: '2.0.0' }), ApiSchemaValidationError);
});

test('parseSubmitDecisionRequestV1 rejects an oversized input with REQUEST_TOO_LARGE', () => {
  const oversized = { ...VALID_SUBMIT_REQUEST, input: { blob: 'x'.repeat(30_000) } };
  assert.throws(() => parseSubmitDecisionRequestV1(oversized), (error: unknown) => {
    assert.ok(error instanceof ApiSchemaValidationError);
    assert.equal(error.code, 'REQUEST_TOO_LARGE');
    return true;
  });
});

test('parseSubmitDecisionRequestV1 rejects a non-object input', () => {
  assert.throws(() => parseSubmitDecisionRequestV1({ ...VALID_SUBMIT_REQUEST, input: 'not-an-object' }), ApiSchemaValidationError);
});

test('parseVerifyReceiptRequestV1 accepts any receipt value', () => {
  const parsed = parseVerifyReceiptRequestV1({ schemaVersion: '1.0.0', receipt: { anything: true } });
  assert.deepEqual(parsed.receipt, { anything: true });
});

test('parseVerifyReceiptRequestV1 rejects a missing receipt field', () => {
  assert.throws(() => parseVerifyReceiptRequestV1({ schemaVersion: '1.0.0' }), ApiSchemaValidationError);
});

test('parseDecisionStatusResponseV1 accepts a PENDING response', () => {
  const value = { schemaVersion: '1.0.0', decisionId: 'dec_1', status: 'PENDING', submittedAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z' };
  assert.deepEqual(parseDecisionStatusResponseV1(value), value);
});

test('parseDecisionStatusResponseV1 accepts a FINALIZED response', () => {
  const value = {
    schemaVersion: '1.0.0',
    decisionId: 'dec_1',
    status: 'FINALIZED',
    result: { decision: 'ACCEPT' },
    verification: {
      receiptId: 'r1',
      validatorSetId: 'vs1',
      matchingValidators: 3,
      requiredQuorum: 2,
      policyHash: 'sha256:' + 'a'.repeat(64),
      profileHash: 'sha256:' + 'b'.repeat(64),
      inputHash: 'sha256:' + 'c'.repeat(64),
      outputHash: 'sha256:' + 'd'.repeat(64),
      executionHash: 'sha256:' + 'e'.repeat(64),
    },
    submittedAt: '2026-08-03T00:00:00.000Z',
    finalizedAt: '2026-08-03T00:00:01.000Z',
  };
  assert.deepEqual(parseDecisionStatusResponseV1(value), value);
});

test('parseDecisionStatusResponseV1 rejects an unknown status value', () => {
  const value = { schemaVersion: '1.0.0', decisionId: 'dec_1', status: 'BOGUS', submittedAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z' };
  assert.throws(() => parseDecisionStatusResponseV1(value), ApiSchemaValidationError);
});

test('parseVerifyReceiptResponseV1 accepts the named-checks array shape from @ddn/receipt-sdk', () => {
  const value = {
    schemaVersion: '1.0.0',
    status: 'INVALID',
    checks: [
      { name: 'schemaValid', passed: true },
      { name: 'receiptIdMatchesContent', passed: false, detail: 'mismatch' },
    ],
  };
  assert.deepEqual(parseVerifyReceiptResponseV1(value), value);
});

test('parseVerifyReceiptResponseV1 rejects a checks entry missing "passed"', () => {
  const value = { schemaVersion: '1.0.0', status: 'VALID', checks: [{ name: 'schemaValid' }] };
  assert.throws(() => parseVerifyReceiptResponseV1(value), ApiSchemaValidationError);
});

test('parsePolicyListResponseV1 accepts an empty policy list', () => {
  const value = { schemaVersion: '1.0.0', policies: [] };
  assert.deepEqual(parsePolicyListResponseV1(value), value);
});

test('parsePolicyDetailResponseV1 accepts a well-formed detail response', () => {
  const value = {
    schemaVersion: '1.0.0',
    policyId: 'negotiation-v1',
    policyVersion: '1.0.0',
    policyHash: 'sha256:' + 'a'.repeat(64),
    profileHash: 'sha256:' + 'b'.repeat(64),
    status: 'ACTIVE',
    inputSchema: {},
    outputSchema: {},
    reasonCodes: ['OFFER_AT_OR_ABOVE_LIST'],
  };
  assert.deepEqual(parsePolicyDetailResponseV1(value), value);
});

const VALID_ANCHOR_RESPONSE = {
  schemaVersion: '1.0.0',
  receiptId: 'sha256:' + 'a'.repeat(64),
  batchId: 'sha256:' + 'b'.repeat(64),
  merkleRoot: 'sha256:' + 'c'.repeat(64),
  proof: { leafHash: 'sha256:' + 'a'.repeat(64), leafIndex: 0, siblings: [], totalLeaves: 1 },
  chain: { chainId: 31337, contractAddress: '0x' + '0'.repeat(40) },
  confirmation: {
    txHash: '0x' + '1'.repeat(64),
    blockNumber: 42,
    blockHash: '0x' + '2'.repeat(64),
    confirmedAt: '2026-08-03T00:00:00.000Z',
  },
};

test('parseGetAnchorResponseV1 accepts a well-formed anchor response', () => {
  assert.deepEqual(parseGetAnchorResponseV1(VALID_ANCHOR_RESPONSE), VALID_ANCHOR_RESPONSE);
});

test('parseGetAnchorResponseV1 rejects an unknown top-level field', () => {
  assert.throws(() => parseGetAnchorResponseV1({ ...VALID_ANCHOR_RESPONSE, extra: 'x' }), ApiSchemaValidationError);
});

test('parseGetAnchorResponseV1 rejects an unknown nested proof field', () => {
  const value = { ...VALID_ANCHOR_RESPONSE, proof: { ...VALID_ANCHOR_RESPONSE.proof, extra: 'x' } };
  assert.throws(() => parseGetAnchorResponseV1(value), ApiSchemaValidationError);
});

test('parseGetAnchorResponseV1 rejects a missing confirmation field', () => {
  const confirmation: Record<string, unknown> = { ...VALID_ANCHOR_RESPONSE.confirmation };
  delete confirmation.blockHash;
  assert.throws(() => parseGetAnchorResponseV1({ ...VALID_ANCHOR_RESPONSE, confirmation }), ApiSchemaValidationError);
});

const VALID_VALIDATOR_PROGRESS_RESPONSE = {
  schemaVersion: '1.0.0',
  decisionId: 'dec_1',
  validators: [
    { validatorId: 'sha256:' + 'a'.repeat(64), phase: 'PENDING', updatedAt: '2026-08-04T00:00:00.000Z' },
    { validatorId: 'sha256:' + 'b'.repeat(64), phase: 'SUCCEEDED', updatedAt: '2026-08-04T00:00:01.000Z', outputHash: 'sha256:' + 'c'.repeat(64) },
  ],
};

test('parseValidatorProgressResponseV1 accepts a well-formed response, including an empty validators array', () => {
  assert.deepEqual(parseValidatorProgressResponseV1(VALID_VALIDATOR_PROGRESS_RESPONSE), VALID_VALIDATOR_PROGRESS_RESPONSE);
  const empty = { schemaVersion: '1.0.0', decisionId: 'dec_1', validators: [] };
  assert.deepEqual(parseValidatorProgressResponseV1(empty), empty);
});

test('parseValidatorProgressResponseV1 rejects an unknown phase value', () => {
  const value = { ...VALID_VALIDATOR_PROGRESS_RESPONSE, validators: [{ ...VALID_VALIDATOR_PROGRESS_RESPONSE.validators[0], phase: 'BOGUS' }] };
  assert.throws(() => parseValidatorProgressResponseV1(value), ApiSchemaValidationError);
});

test('parseValidatorProgressResponseV1 rejects an unknown field on a validator entry', () => {
  const value = {
    ...VALID_VALIDATOR_PROGRESS_RESPONSE,
    validators: [{ ...VALID_VALIDATOR_PROGRESS_RESPONSE.validators[0], stderr: 'should never be here' }],
  };
  assert.throws(() => parseValidatorProgressResponseV1(value), ApiSchemaValidationError);
});

test('parseApiErrorResponseV1 accepts a well-formed error response', () => {
  const value = { schemaVersion: '1.0.0', error: { code: 'UNAUTHORIZED', message: 'nope', requestId: 'req-1' } };
  assert.deepEqual(parseApiErrorResponseV1(value), value);
});

test('parseApiErrorResponseV1 rejects an error missing requestId', () => {
  const value = { schemaVersion: '1.0.0', error: { code: 'UNAUTHORIZED', message: 'nope' } };
  assert.throws(() => parseApiErrorResponseV1(value), ApiSchemaValidationError);
});
