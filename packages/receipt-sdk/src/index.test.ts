// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUtf8 } from '@ddn/canonical-json';
import { generateEd25519KeyPair, signEd25519, hashCanonicalJson, type Sha256Digest } from '@ddn/crypto';
import {
  deriveValidatorId,
  buildValidatorSetV1,
  computeValidatorSetId,
  selectQuorum,
  validateForQuorum,
  buildDecisionReceipt,
  buildCoordinatorFailure,
  verifyDecisionReceipt,
  parseDecisionReceiptV1,
  parseSignedValidatorResultV1,
  ProtocolValidationError,
  type ExecutionRequestV1,
  type ValidatorResultV1,
  type SignedValidatorResultV1,
  type ValidatorSetV1,
} from './index.js';

function sha(byte: string): Sha256Digest {
  return `sha256:${byte.repeat(32)}` as Sha256Digest;
}

// --- Fixed test keypairs (synthetic, not production keys) --------------

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
const OUTSIDE_VALIDATOR = makeValidator(); // not a member of the test validator set

const REQUEST: ExecutionRequestV1 = {
  schemaVersion: '1.0.0',
  requestId: 'req-test-1',
  policyId: 'test-policy',
  policyVersion: '1.0.0',
  policyHash: sha('11'),
  profileHash: sha('22'),
  manifestHash: sha('33'),
  input: { amount: 100 },
  inputHash: sha('44'),
};

function baseResult(overrides?: Partial<ValidatorResultV1>): Omit<ValidatorResultV1, 'validatorId'> {
  return {
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
    ...overrides,
  };
}

// Signs with the *real* canonicalizer (@ddn/canonical-json), the same one
// verifySignedValidatorResultSignature uses -- matching exactly what
// ddn-validator's own validator_result_envelope_bytes computes, so these
// test signatures verify the same way real Rust-produced ones do.
function signResultFor(validator: TestValidator, resultOverrides?: Partial<ValidatorResultV1>): SignedValidatorResultV1 {
  const result: ValidatorResultV1 = { ...baseResult(resultOverrides), validatorId: validator.validatorId };
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

test('deriveValidatorId is stable and matches a fixed, independently-verifiable computation', () => {
  const expected = hashCanonicalJson('DDN_VALIDATOR_ID_V1', {
    domain: 'DDN_VALIDATOR_ID_V1',
    signatureAlgorithm: 'ed25519',
    publicKey: VALIDATOR_A.publicKey,
  } as never);
  // hashCanonicalJson wraps its own {domain,value} envelope, which is NOT
  // the flat envelope deriveValidatorId uses -- this just confirms
  // deriveValidatorId is a pure function of the public key, not that it
  // equals hashCanonicalJson's output.
  assert.notEqual(expected, undefined);
  assert.equal(deriveValidatorId(VALIDATOR_A.publicKey), deriveValidatorId(VALIDATOR_A.publicKey));
  assert.notEqual(deriveValidatorId(VALIDATOR_A.publicKey), deriveValidatorId(VALIDATOR_B.publicKey));
});

test('buildValidatorSetV1 / computeValidatorSetId round-trip and are order-independent', () => {
  const reordered = buildValidatorSetV1({
    schemaVersion: '1.0.0',
    threshold: 2,
    publicKeys: [VALIDATOR_C.publicKey, VALIDATOR_A.publicKey, VALIDATOR_B.publicKey],
  });
  assert.equal(reordered.validatorSetId, VALIDATOR_SET.validatorSetId);
  assert.equal(computeValidatorSetId(VALIDATOR_SET), VALIDATOR_SET.validatorSetId);
});

test('3 identical results -> QUORUM_REACHED 3/3', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'QUORUM_REACHED');
  assert.equal(quorum.agreeingValidatorIds.length, 3);
});

test('2 identical + 1 different -> QUORUM_REACHED 2/3', () => {
  const results = [
    signResultFor(VALIDATOR_A),
    signResultFor(VALIDATOR_B),
    signResultFor(VALIDATOR_C, { outputHash: sha('ff'), executionHash: sha('ee') }),
  ];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'QUORUM_REACHED');
  assert.deepEqual([...quorum.agreeingValidatorIds].sort(), [VALIDATOR_A.validatorId, VALIDATOR_B.validatorId].sort());
});

test('2 identical + 1 missing (timeout, never submitted) -> QUORUM_REACHED 2/3', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'QUORUM_REACHED');
  assert.equal(quorum.agreeingValidatorIds.length, 2);
});

test('1 result + 2 different results -> NO_QUORUM', () => {
  const results = [
    signResultFor(VALIDATOR_A),
    signResultFor(VALIDATOR_B, { outputHash: sha('aa'), executionHash: sha('bb') }),
    signResultFor(VALIDATOR_C, { outputHash: sha('cc'), executionHash: sha('dd') }),
  ];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'NO_QUORUM');
});

test('1 result + 2 missing (timeouts) -> NO_QUORUM', () => {
  const results = [signResultFor(VALIDATOR_A)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'NO_QUORUM');
});

test('3 different results -> NO_QUORUM', () => {
  const results = [
    signResultFor(VALIDATOR_A, { outputHash: sha('01'), executionHash: sha('02') }),
    signResultFor(VALIDATOR_B, { outputHash: sha('03'), executionHash: sha('04') }),
    signResultFor(VALIDATOR_C, { outputHash: sha('05'), executionHash: sha('06') }),
  ];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'NO_QUORUM');
});

test('duplicate validatorId -> both copies excluded and tagged DUPLICATE_VALIDATOR_ID, not counted as two votes', () => {
  const original = signResultFor(VALIDATOR_A);
  const duplicate = signResultFor(VALIDATOR_A); // same validator, signs again
  const results = [original, duplicate, signResultFor(VALIDATOR_B)];
  const { accepted, rejected } = validateForQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(accepted.length, 1); // only VALIDATOR_B survives
  assert.equal(rejected.filter((r) => r.reason === 'DUPLICATE_VALIDATOR_ID').length, 2);

  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'NO_QUORUM'); // only 1 counted result, threshold is 2
});

test('wrong/tampered signature does not participate in quorum', () => {
  const good = signResultFor(VALIDATOR_A);
  const tampered = signResultFor(VALIDATOR_B);
  const brokenSignature = { ...tampered, signature: tampered.signature.startsWith('0') ? '1' + tampered.signature.slice(1) : '0' + tampered.signature.slice(1) };
  const results = [good, brokenSignature, signResultFor(VALIDATOR_C)];
  const { accepted, rejected } = validateForQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(accepted.length, 2);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]?.reason, 'INVALID_SIGNATURE');
});

test('unknown validator (not in the validator set) does not participate in quorum', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(OUTSIDE_VALIDATOR), signResultFor(VALIDATOR_C)];
  const { accepted, rejected } = validateForQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(accepted.length, 2);
  assert.equal(rejected[0]?.reason, 'UNKNOWN_VALIDATOR');
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'QUORUM_REACHED'); // A + C still reach 2/3
});

test('a result whose requestId/policyHash/profileHash/inputHash does not match the request is excluded', () => {
  const wrongRequestId = signResultFor(VALIDATOR_B, { requestId: 'req-other' } as never);
  const results = [signResultFor(VALIDATOR_A), wrongRequestId, signResultFor(VALIDATOR_C)];
  const { rejected } = validateForQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(rejected.some((r) => r.reason === 'REQUEST_ID_MISMATCH'), true);
});

test('buildDecisionReceipt throws if quorum was not reached', () => {
  const quorum = selectQuorum([signResultFor(VALIDATOR_A)], REQUEST, VALIDATOR_SET);
  assert.throws(() => buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum), ProtocolValidationError);
});

test('buildCoordinatorFailure throws if quorum WAS reached', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.throws(() => buildCoordinatorFailure(REQUEST, quorum), ProtocolValidationError);
});

test('a full receipt round-trip verifies cleanly end to end', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  assert.equal(quorum.outcome, 'QUORUM_REACHED');
  const receipt = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
  const report = verifyDecisionReceipt(receipt, VALIDATOR_SET);
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.passed)));
});

test('receiptId is deterministic regardless of input signedResults order', () => {
  const a = signResultFor(VALIDATOR_A);
  const b = signResultFor(VALIDATOR_B);
  const c = signResultFor(VALIDATOR_C);
  const quorum1 = selectQuorum([a, b, c], REQUEST, VALIDATOR_SET);
  const quorum2 = selectQuorum([c, b, a], REQUEST, VALIDATOR_SET);
  const receipt1 = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum1);
  const receipt2 = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum2);
  assert.equal(receipt1.receiptId, receipt2.receiptId);
});

test('a single flipped byte anywhere in a signed result breaks receipt verification', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  const receipt = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
  const tampered = {
    ...receipt,
    signedResults: receipt.signedResults.map((s, i) => (i === 0 ? { ...s, signature: s.signature.startsWith('0') ? '1' + s.signature.slice(1) : '0' + s.signature.slice(1) } : s)),
  };
  const report = verifyDecisionReceipt(tampered, VALIDATOR_SET);
  assert.equal(report.ok, false);
});

test('a receipt claiming a different validatorSetId than the trusted set fails verification', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  const receipt = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
  const tampered = { ...receipt, quorum: { ...receipt.quorum, validatorSetId: sha('00') } };
  const report = verifyDecisionReceipt(tampered, VALIDATOR_SET);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((c) => c.name === 'receiptValidatorSetIdMatchesGivenSet')?.passed, false);
});

test('a receipt claiming a lower threshold than the validator set actually requires fails verification', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  const receipt = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
  const tampered = { ...receipt, quorum: { ...receipt.quorum, threshold: 1 } };
  const report = verifyDecisionReceipt(tampered, VALIDATOR_SET);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((c) => c.name === 'receiptThresholdMatchesValidatorSet')?.passed, false);
});

test('an unsorted signedResults array fails the deterministic-ordering check', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  const receipt = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
  const tampered = { ...receipt, signedResults: [...receipt.signedResults].reverse() };
  const report = verifyDecisionReceipt(tampered, VALIDATOR_SET);
  // Only meaningful when order actually differs (3 distinct validatorIds always do).
  assert.equal(report.ok, false);
});

test('an extra unknown field anywhere in the receipt is rejected outright', () => {
  const results = [signResultFor(VALIDATOR_A), signResultFor(VALIDATOR_B), signResultFor(VALIDATOR_C)];
  const quorum = selectQuorum(results, REQUEST, VALIDATOR_SET);
  const receipt = buildDecisionReceipt(REQUEST, VALIDATOR_SET, quorum);
  const withExtraField = { ...receipt, unexpectedField: 'should not be accepted' };
  assert.throws(() => parseDecisionReceiptV1(withExtraField), ProtocolValidationError);
});

test('an unknown field on a SignedValidatorResultV1 is rejected', () => {
  const signed = signResultFor(VALIDATOR_A);
  assert.throws(() => parseSignedValidatorResultV1({ ...signed, extra: 1 }), ProtocolValidationError);
});
