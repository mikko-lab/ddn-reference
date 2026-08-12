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
import { verifyAnchoredDecisionReceipt, verifyReceiptAgainstSuppliedBatch, type ChainReader, type OnChainBatch } from './anchor-verification.js';

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
  requestId: 'req-anchor-test-1',
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

const OTHER_VALIDATOR_SET: ValidatorSetV1 = buildValidatorSetV1({
  schemaVersion: '1.0.0',
  threshold: 2,
  publicKeys: [makeValidator().publicKey, makeValidator().publicKey, makeValidator().publicKey],
});

function buildTestReceipt(): DecisionReceiptV1 {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  return buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
}

const CHAIN = { chainId: 31337, contractAddress: '0x' + 'ab'.repeat(20) };

function buildFixture() {
  const receipt = buildTestReceipt();
  const otherReceiptId = sha('ff'); // a second, unrelated leaf so the proof has a real sibling
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

test('verifyReceiptAgainstSuppliedBatch succeeds end to end for a genuinely anchored receipt', () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const result = verifyReceiptAgainstSuppliedBatch(receipt, VALIDATOR_SET, anchorRecord, onChainBatch, CHAIN);
  assert.equal(result.ok, true);
});

test('verifyAnchoredDecisionReceipt succeeds end to end, fetching the batch itself via ChainReader', async () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const result = await verifyAnchoredDecisionReceipt(receipt, VALIDATOR_SET, anchorRecord, fakeChainReader(onChainBatch));
  assert.equal(result.ok, true);
});

test('fails at RECEIPT when the receipt does not verify against the given validator set', () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const result = verifyReceiptAgainstSuppliedBatch(receipt, OTHER_VALIDATOR_SET, anchorRecord, onChainBatch, CHAIN);
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, 'RECEIPT');
  assert.ok(result.receiptVerification);
});

test('fails at LEAF_MISMATCH when anchorRecord.receiptId does not match the receipt', () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const tampered = { ...anchorRecord, receiptId: sha('99') };
  const result = verifyReceiptAgainstSuppliedBatch(receipt, VALIDATOR_SET, tampered, onChainBatch, CHAIN);
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, 'LEAF_MISMATCH');
});

test('fails at PROOF when the proof does not replay to anchorRecord.merkleRoot', () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const tampered = { ...anchorRecord, proof: { ...anchorRecord.proof, siblings: [sha('forged')] } };
  const result = verifyReceiptAgainstSuppliedBatch(receipt, VALIDATOR_SET, tampered, onChainBatch, CHAIN);
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, 'PROOF');
});

test('fails at PROOF when proof.totalLeaves disagrees with the on-chain decisionCount', () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const mismatchedBatch = { ...onChainBatch, decisionCount: 5 };
  const result = verifyReceiptAgainstSuppliedBatch(receipt, VALIDATOR_SET, anchorRecord, mismatchedBatch, CHAIN);
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, 'PROOF');
});

test('fails at ON_CHAIN_MISMATCH when the supplied batch root disagrees with anchorRecord.merkleRoot', () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const differentRootBatch = { ...onChainBatch, merkleRoot: sha('de') };
  const result = verifyReceiptAgainstSuppliedBatch(receipt, VALIDATOR_SET, anchorRecord, differentRootBatch, CHAIN);
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, 'ON_CHAIN_MISMATCH');
});

test('fails at CHAIN_BINDING when anchorRecord.chain disagrees with the caller-trusted chain', () => {
  const { receipt, anchorRecord, onChainBatch } = buildFixture();
  const result = verifyReceiptAgainstSuppliedBatch(receipt, VALIDATOR_SET, anchorRecord, onChainBatch, {
    chainId: 999,
    contractAddress: CHAIN.contractAddress,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, 'CHAIN_BINDING');
});

test('verifyAnchoredDecisionReceipt fails at CHAIN_BINDING before ever calling ChainReader.getBatch', async () => {
  const { receipt, anchorRecord } = buildFixture();
  let getBatchCalled = false;
  const reader: ChainReader = {
    chainId: 999,
    contractAddress: CHAIN.contractAddress,
    getBatch: async () => {
      getBatchCalled = true;
      throw new Error('should never be called');
    },
  };
  const result = await verifyAnchoredDecisionReceipt(receipt, VALIDATOR_SET, anchorRecord, reader);
  assert.equal(result.ok, false);
  assert.equal(result.failedAt, 'CHAIN_BINDING');
  assert.equal(getBatchCalled, false);
});
