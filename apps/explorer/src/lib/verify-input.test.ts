// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerifyInput } from './verify-input.js';

function sha(byte: string): string {
  return `sha256:${byte.repeat(32)}`;
}

function validReceipt(): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    receiptId: sha('11'),
    request: {
      schemaVersion: '1.0.0',
      requestId: 'req-1',
      policyId: 'test-policy',
      policyVersion: '1.0.0',
      policyHash: sha('22'),
      profileHash: sha('33'),
      manifestHash: sha('44'),
      input: { amount: 1 },
      inputHash: sha('55'),
    },
    quorum: {
      validatorSetId: sha('66'),
      threshold: 1,
      totalValidators: 1,
      agreeingValidatorIds: [sha('77')],
    },
    consensus: {
      policyHash: sha('22'),
      profileHash: sha('33'),
      inputHash: sha('55'),
      outputHash: sha('99'),
      executionHash: sha('aa'),
      status: 'SUCCESS',
    },
    signedResults: [
      {
        result: {
          schemaVersion: '1.0.0',
          requestId: 'req-1',
          validatorId: sha('77'),
          policyHash: sha('22'),
          profileHash: sha('33'),
          manifestHash: sha('44'),
          inputHash: sha('55'),
          output: { decision: 'ACCEPT' },
          outputHash: sha('99'),
          executionHash: sha('aa'),
          status: 'SUCCESS',
        },
        validatorPublicKey: 'bb'.repeat(32),
        signatureAlgorithm: 'ed25519',
        signature: 'cc'.repeat(64),
      },
    ],
  };
}

test('parseVerifyInput rejects empty receipt input with a clear message', () => {
  const result = parseVerifyInput('   ', '');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /paste or upload/i);
});

test('parseVerifyInput rejects invalid JSON in the receipt field', () => {
  const result = parseVerifyInput('{not json', '');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not valid json/i);
});

test('parseVerifyInput rejects a well-formed JSON object that is not a valid DecisionReceiptV1', () => {
  const result = parseVerifyInput('{"hello":"world"}', '');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /malformed/i);
});

test('parseVerifyInput accepts a well-formed receipt with no anchor record supplied', () => {
  const receipt = validReceipt();
  const result = parseVerifyInput(JSON.stringify(receipt), '   ');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.anchorRecord, undefined);
    assert.equal(result.receipt.receiptId, receipt.receiptId);
  }
});

test('parseVerifyInput rejects a well-formed JSON object that is not a valid AnchorRecordV1', () => {
  const receipt = validReceipt();
  const result = parseVerifyInput(JSON.stringify(receipt), '{"not":"an anchor record"}');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /anchor record is malformed/i);
});
