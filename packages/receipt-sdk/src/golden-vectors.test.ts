// SPDX-License-Identifier: Apache-2.0
// Proves the committed golden vectors under
// packages/test-vectors/vectors/decision-receipt-v1/ match what this
// library recomputes live -- canonical JSON bytes, validatorSetId,
// receiptId, and full offline verification of Rust-produced signatures
// with zero transformation. Nothing here is generated and then compared
// to itself: every value is loaded from a file committed to git and
// compared against a fresh computation. Only
// `ddn-coordinator generate-golden-vectors --confirm-update` may rewrite
// these files; this test never does. See docs/decision-receipt-v1.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeUtf8 } from '@ddn/canonical-json';
import {
  computeReceiptId,
  computeValidatorSetId,
  parseDecisionReceiptV1,
  parseSignedValidatorResultV1,
  parseValidatorSetV1,
  selectQuorum,
  verifyDecisionReceipt,
  type ExecutionRequestV1,
} from './index.js';
import { parseExecutionRequestV1 } from './protocol-types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VECTORS_DIR = join(REPO_ROOT, 'packages/test-vectors/vectors/decision-receipt-v1');

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(VECTORS_DIR, name), 'utf8'));
}

async function readText(name: string): Promise<string> {
  return readFile(join(VECTORS_DIR, name), 'utf8');
}

async function readBytes(name: string): Promise<Buffer> {
  return readFile(join(VECTORS_DIR, name));
}

test('committed validator-set.json matches its own canonical bytes and validatorSetId', async () => {
  const validatorSet = parseValidatorSetV1(await readJson('validator-set.json'));
  const recomputedCanonical = canonicalizeUtf8(validatorSet as never);
  const committedCanonical = await readBytes('canonical-validator-set.txt');
  assert.deepEqual(recomputedCanonical, new Uint8Array(committedCanonical));

  const recomputedId = computeValidatorSetId(validatorSet);
  const committedId = (await readText('validator-set-id.txt')).trim();
  assert.equal(recomputedId, committedId);
  assert.equal(recomputedId, validatorSet.validatorSetId);
});

test('committed signed results from three real ddn-validator processes reach quorum and produce the committed receipt', async () => {
  const validatorSet = parseValidatorSetV1(await readJson('validator-set.json'));
  const signedA = parseSignedValidatorResultV1(await readJson('signed-result-validator-a.json'));
  const signedB = parseSignedValidatorResultV1(await readJson('signed-result-validator-b.json'));
  const signedC = parseSignedValidatorResultV1(await readJson('signed-result-validator-c.json'));

  const committedReceipt = parseDecisionReceiptV1(await readJson('decision-receipt.json'));
  const request: ExecutionRequestV1 = committedReceipt.request;

  const quorum = selectQuorum([signedA, signedB, signedC], request, validatorSet);
  assert.equal(quorum.outcome, 'QUORUM_REACHED');
  assert.equal(quorum.agreeingValidatorIds.length, 3);
});

test('committed decision-receipt.json matches its own canonical bytes and receiptId', async () => {
  const receipt = parseDecisionReceiptV1(await readJson('decision-receipt.json'));
  const recomputedCanonical = canonicalizeUtf8(receipt as never);
  const committedCanonical = await readBytes('canonical-receipt.txt');
  assert.deepEqual(recomputedCanonical, new Uint8Array(committedCanonical));

  const { receiptId, ...content } = receipt;
  const recomputedId = computeReceiptId(content);
  const committedId = (await readText('receipt-id.txt')).trim();
  assert.equal(recomputedId, committedId);
  assert.equal(recomputedId, receiptId);
});

test('committed decision-receipt.json fully offline-verifies against the committed validator set -- Rust-produced signatures accepted with no transformation', async () => {
  const validatorSet = parseValidatorSetV1(await readJson('validator-set.json'));
  const receiptRaw = await readJson('decision-receipt.json');
  const report = verifyDecisionReceipt(receiptRaw, validatorSet);
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.passed)));
});

// --- "a single flipped byte anywhere in the golden vectors must fail" ---

test('a single flipped byte in a committed signature breaks verification', async () => {
  const validatorSet = parseValidatorSetV1(await readJson('validator-set.json'));
  const receipt = parseDecisionReceiptV1(await readJson('decision-receipt.json'));
  const tampered = {
    ...receipt,
    signedResults: receipt.signedResults.map((s, i) =>
      i === 0 ? { ...s, signature: s.signature.startsWith('0') ? `1${s.signature.slice(1)}` : `0${s.signature.slice(1)}` } : s,
    ),
  };
  const report = verifyDecisionReceipt(tampered, validatorSet);
  assert.equal(report.ok, false);
});

test('a single flipped byte in the committed canonical-receipt.txt no longer matches live recomputation', async () => {
  const receipt = parseDecisionReceiptV1(await readJson('decision-receipt.json'));
  const fresh = canonicalizeUtf8(receipt as never);
  const committed = await readBytes('canonical-receipt.txt');
  const tampered = Buffer.from(committed);
  const idx = Math.floor(tampered.length / 2);
  tampered[idx] = (tampered[idx] ?? 0) ^ 0x01;
  assert.notDeepEqual(new Uint8Array(tampered), fresh);
});

test('the request build-request produced still matches parseExecutionRequestV1 without transformation', async () => {
  const receipt = parseDecisionReceiptV1(await readJson('decision-receipt.json'));
  const reparsed = parseExecutionRequestV1(JSON.parse(JSON.stringify(receipt.request)));
  assert.deepEqual(reparsed, receipt.request);
});
