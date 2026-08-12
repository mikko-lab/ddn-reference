// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnchorRecordV1 } from './anchor-record.js';
import { ProtocolValidationError } from './protocol-types.js';

function sha(byte: string) {
  return `sha256:${byte.repeat(32)}`;
}

const VALID_RECORD = {
  schemaVersion: '1.0.0',
  receiptId: sha('a1'),
  batchId: sha('b2'),
  merkleRoot: sha('c3'),
  proof: { leafHash: sha('a1'), leafIndex: 0, siblings: [], totalLeaves: 1 },
  chain: { chainId: 31337, contractAddress: '0x' + '0'.repeat(40) },
  confirmation: { txHash: '0x' + '1'.repeat(64), blockNumber: 42, blockHash: '0x' + '2'.repeat(64), confirmedAt: '2026-08-03T00:00:00.000Z' },
};

test('parseAnchorRecordV1 accepts a well-formed record', () => {
  assert.deepEqual(parseAnchorRecordV1(VALID_RECORD), VALID_RECORD);
});

test('parseAnchorRecordV1 rejects an unknown top-level field', () => {
  assert.throws(() => parseAnchorRecordV1({ ...VALID_RECORD, extra: 'x' }), ProtocolValidationError);
});

test('parseAnchorRecordV1 rejects an unknown proof field', () => {
  const value = { ...VALID_RECORD, proof: { ...VALID_RECORD.proof, extra: 'x' } };
  assert.throws(() => parseAnchorRecordV1(value), ProtocolValidationError);
});

test('parseAnchorRecordV1 rejects leafIndex >= totalLeaves', () => {
  const value = { ...VALID_RECORD, proof: { ...VALID_RECORD.proof, leafIndex: 1, totalLeaves: 1 } };
  assert.throws(() => parseAnchorRecordV1(value), ProtocolValidationError);
});

test('parseAnchorRecordV1 rejects a malformed contractAddress', () => {
  const value = { ...VALID_RECORD, chain: { ...VALID_RECORD.chain, contractAddress: 'not-an-address' } };
  assert.throws(() => parseAnchorRecordV1(value), ProtocolValidationError);
});

test('parseAnchorRecordV1 rejects a non-sha256 receiptId', () => {
  assert.throws(() => parseAnchorRecordV1({ ...VALID_RECORD, receiptId: 'not-a-hash' }), ProtocolValidationError);
});

test('parseAnchorRecordV1 rejects a missing confirmation field', () => {
  const confirmation: Record<string, unknown> = { ...VALID_RECORD.confirmation };
  delete confirmation.blockHash;
  assert.throws(() => parseAnchorRecordV1({ ...VALID_RECORD, confirmation }), ProtocolValidationError);
});
