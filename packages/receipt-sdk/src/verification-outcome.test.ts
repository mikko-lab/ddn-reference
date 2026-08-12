// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUtf8 } from '@ddn/canonical-json';
import { generateEd25519KeyPair, signEd25519, type Sha256Digest } from '@ddn/crypto';
import {
  deriveValidatorId,
  buildValidatorSetV1,
  selectQuorum,
  buildDecisionReceipt,
  type ExecutionRequestV1,
  type ValidatorResultV1,
  type SignedValidatorResultV1,
  type ValidatorSetV1,
  type DecisionReceiptV1,
} from './index.js';
import { buildMerkleTree, buildMerkleProof } from './merkle.js';
import type { AnchorRecordV1 } from './anchor-record.js';
import type { ChainReader, OnChainBatch } from './anchor-verification.js';
import { computeVerificationOutcome } from './verification-outcome.js';

function sha(byte: string): Sha256Digest {
  return `sha256:${byte.repeat(32)}` as Sha256Digest;
}

interface TestValidator {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly validatorId: Sha256Digest;
}

function makeValidator(): TestValidator {
  const { publicKey, privateKey } = generateEd25519KeyPair();
  return { publicKey, privateKey, validatorId: deriveValidatorId(publicKey) };
}

const VALIDATOR_A = makeValidator();
const VALIDATOR_B = makeValidator();
const VALIDATOR_C = makeValidator();

const REQUEST: ExecutionRequestV1 = {
  schemaVersion: '1.0.0',
  requestId: 'req-outcome-test-1',
  policyId: 'test-policy',
  policyVersion: '1.0.0',
  policyHash: sha('11'),
  profileHash: sha('22'),
  manifestHash: sha('33'),
  input: { amount: 100 },
  inputHash: sha('44'),
};

function signResultFor(validator: TestValidator): SignedValidatorResultV1 {
  const result: ValidatorResultV1 = {
    schemaVersion: '1.0.0',
    requestId: REQUEST.requestId,
    policyHash: REQUEST.policyHash,
    profileHash: REQUEST.profileHash,
    manifestHash: REQUEST.manifestHash,
    inputHash: REQUEST.inputHash,
    output: { decision: 'ACCEPT' },
    outputHash: sha('55'),
    executionHash: sha('66'),
    status: 'SUCCESS',
    validatorId: validator.validatorId,
  };
  const envelope = { domain: 'DDN_VALIDATOR_RESULT_V1', value: result };
  const message = canonicalizeUtf8(envelope as never);
  const signature = signEd25519(validator.privateKey, message);
  return { result, validatorPublicKey: validator.publicKey, signatureAlgorithm: 'ed25519', signature };
}

const VALIDATOR_SET: ValidatorSetV1 = buildValidatorSetV1({
  schemaVersion: '1.0.0',
  threshold: 2,
  publicKeys: [VALIDATOR_A.publicKey, VALIDATOR_B.publicKey, VALIDATOR_C.publicKey],
});

function buildTestReceipt(): DecisionReceiptV1 {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  return buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
}

const CHAIN = { chainId: 31337, contractAddress: '0x' + 'ab'.repeat(20) };

function buildFixture() {
  const receipt = buildTestReceipt();
  const otherReceiptId = sha('ff');
  const tree = buildMerkleTree([receipt.receiptId, otherReceiptId]);
  const proof = buildMerkleProof(tree, receipt.receiptId);
  const anchorRecord: AnchorRecordV1 = {
    schemaVersion: '1.0.0',
    receiptId: receipt.receiptId,
    batchId: sha('cc'),
    merkleRoot: tree.root,
    proof,
    chain: CHAIN,
    confirmation: { txHash: '0x' + '1'.repeat(64), blockNumber: 42, blockHash: '0x' + '2'.repeat(64), confirmedAt: '2026-08-03T00:00:00.000Z' },
  };
  const onChainBatch: OnChainBatch = { merkleRoot: tree.root, decisionCount: 2 };
  return { receipt, anchorRecord, onChainBatch };
}

function fakeChainReader(batch: OnChainBatch): ChainReader {
  return { chainId: CHAIN.chainId, contractAddress: CHAIN.contractAddress, getBatch: async () => batch };
}

function throwingChainReader(message: string): ChainReader {
  return {
    chainId: CHAIN.chainId,
    contractAddress: CHAIN.contractAddress,
    getBatch: async () => {
      throw new Error(message);
    },
  };
}

test('computeVerificationOutcome is VALID when the receipt and anchor both check out', async () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const result = await computeVerificationOutcome(receipt, VALIDATOR_SET, anchorRecord, fakeChainReader(onChainBatch));
  assert.equal(result.outcome, 'VALID');
});

test('computeVerificationOutcome is INVALID when the receipt itself fails self-verification', async () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const tamperedReceipt = { ...receipt, quorum: { ...receipt.quorum, threshold: 99 } };
  const result = await computeVerificationOutcome(tamperedReceipt, VALIDATOR_SET, anchorRecord, fakeChainReader(onChainBatch));
  assert.equal(result.outcome, 'INVALID');
  assert.equal(result.receiptVerification?.ok, false);
});

test('computeVerificationOutcome is INCOMPLETE when no anchor record was supplied, never INVALID', async () => {
  const { receipt } = buildFixture();
  const result = await computeVerificationOutcome(receipt, VALIDATOR_SET, undefined, undefined);
  assert.equal(result.outcome, 'INCOMPLETE');
});

test('computeVerificationOutcome is INCOMPLETE when an anchor record is supplied but no chain reader is configured', async () => {
  const { receipt, anchorRecord } = buildFixture();
  const result = await computeVerificationOutcome(receipt, VALIDATOR_SET, anchorRecord, undefined);
  assert.equal(result.outcome, 'INCOMPLETE');
});

test('computeVerificationOutcome is INCOMPLETE (never INVALID) when the chain read itself throws', async () => {
  const { receipt, anchorRecord } = buildFixture();
  const result = await computeVerificationOutcome(receipt, VALIDATOR_SET, anchorRecord, throwingChainReader('ECONNREFUSED'));
  assert.equal(result.outcome, 'INCOMPLETE');
  assert.match(result.detail, /ECONNREFUSED/);
});

test('computeVerificationOutcome is INVALID when the anchor record was tampered with', async () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const tamperedAnchor = { ...anchorRecord, merkleRoot: sha('99') };
  const result = await computeVerificationOutcome(receipt, VALIDATOR_SET, tamperedAnchor, fakeChainReader(onChainBatch));
  assert.equal(result.outcome, 'INVALID');
  assert.equal(result.anchorVerification?.ok, false);
});
