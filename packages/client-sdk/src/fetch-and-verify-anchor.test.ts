// SPDX-License-Identifier: Apache-2.0
// Uses the committed Milestone 4 golden vectors (a real, validly-signed
// DecisionReceiptV1 and its matching ValidatorSetV1) plus a real Merkle
// tree/proof built over that receipt's own receiptId, so this proves
// fetchAndVerifyAnchor's actual logic -- including that it genuinely
// calls @ddn/receipt-sdk's verifyAnchoredDecisionReceipt and rejects a
// tampered receipt or a tampered proof -- without needing a running
// server or a live chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sha256Digest } from '@ddn/crypto';
import {
  buildMerkleProof,
  buildMerkleTree,
  computeBatchId,
  type AnchorRecordV1,
  type ChainReader,
  type OnChainBatch,
  type ValidatorSetV1,
} from '@ddn/receipt-sdk';
import { DdnClient, type FetchLike } from './client.js';
import { DdnAnchorVerificationError, DdnApiError } from './errors.js';
import { fetchAndVerifyAnchor } from './fetch-and-verify-anchor.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VECTORS_DIR = join(REPO_ROOT, 'packages/test-vectors/vectors/decision-receipt-v1');

function readJson(filename: string): unknown {
  return JSON.parse(readFileSync(join(VECTORS_DIR, filename), 'utf8'));
}

const GOLDEN_RECEIPT = readJson('decision-receipt.json') as { receiptId: Sha256Digest } & Record<string, unknown>;
const GOLDEN_VALIDATOR_SET = readJson('validator-set.json') as ValidatorSetV1;

const OTHER_RECEIPT_ID = ('sha256:' + 'e'.repeat(64)) as Sha256Digest;
const CHAIN = { chainId: 31337, contractAddress: '0x' + 'ab'.repeat(20) };

function buildRealAnchorRecord(): { anchorRecord: AnchorRecordV1; onChainBatch: OnChainBatch } {
  const tree = buildMerkleTree([GOLDEN_RECEIPT.receiptId, OTHER_RECEIPT_ID]);
  const proof = buildMerkleProof(tree, GOLDEN_RECEIPT.receiptId);
  const batchId = computeBatchId(tree.root, tree.leaves.length);
  const anchorRecord: AnchorRecordV1 = {
    schemaVersion: '1.0.0',
    receiptId: GOLDEN_RECEIPT.receiptId,
    batchId,
    merkleRoot: tree.root,
    proof,
    chain: CHAIN,
    confirmation: { txHash: '0x' + '1'.repeat(64), blockNumber: 42, blockHash: '0x' + '2'.repeat(64), confirmedAt: '2026-08-03T00:00:00.000Z' },
  };
  return { anchorRecord, onChainBatch: { merkleRoot: tree.root, decisionCount: tree.leaves.length } };
}

function fakeChainReader(onChainBatch: OnChainBatch): ChainReader {
  return { chainId: CHAIN.chainId, contractAddress: CHAIN.contractAddress, getBatch: async () => onChainBatch };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function buildFakeServer(decisionId: string, receipt: unknown, anchorResponse: { status: number; body: unknown }): FetchLike {
  return async (url) => {
    const path = new URL(url as string).pathname;
    if (path === `/v1/decisions/${decisionId}/receipt`) return jsonResponse(200, receipt);
    if (path === `/v1/decisions/${decisionId}/anchor`) return jsonResponse(anchorResponse.status, anchorResponse.body);
    throw new Error(`unexpected path in fake server: ${path}`);
  };
}

function client(fetchImpl: FetchLike): DdnClient {
  return new DdnClient({ baseUrl: 'https://ddn.example.test', serviceToken: 't'.repeat(32), fetchImpl, maxRetries: 0 });
}

test('fetchAndVerifyAnchor succeeds end to end for a genuinely anchored receipt', async () => {
  const { anchorRecord, onChainBatch } = buildRealAnchorRecord();
  const fetchImpl = buildFakeServer('dec_1', GOLDEN_RECEIPT, { status: 200, body: anchorRecord });

  const result = await fetchAndVerifyAnchor(client(fetchImpl), 'dec_1', {
    validatorSet: GOLDEN_VALIDATOR_SET,
    chainReader: fakeChainReader(onChainBatch),
  });

  assert.equal(result.verification.ok, true);
  assert.equal(result.anchorRecord.receiptId, GOLDEN_RECEIPT.receiptId);
});

test('fetchAndVerifyAnchor propagates a 409 ANCHOR_NOT_AVAILABLE as a typed DdnApiError, not a boolean', async () => {
  const { onChainBatch } = buildRealAnchorRecord();
  const errorBody = { schemaVersion: '1.0.0', error: { code: 'ANCHOR_NOT_AVAILABLE', message: 'decision dec_1 has not been anchored yet', requestId: 'req-1' } };
  const fetchImpl = buildFakeServer('dec_1', GOLDEN_RECEIPT, { status: 409, body: errorBody });

  await assert.rejects(
    () => fetchAndVerifyAnchor(client(fetchImpl), 'dec_1', { validatorSet: GOLDEN_VALIDATOR_SET, chainReader: fakeChainReader(onChainBatch) }),
    (error: unknown) => {
      assert.ok(error instanceof DdnApiError);
      assert.equal(error.code, 'ANCHOR_NOT_AVAILABLE');
      assert.equal(error.httpStatus, 409);
      return true;
    }
  );
});

test('fetchAndVerifyAnchor rejects a malformed anchor response (fails schema parsing) rather than passing it through', async () => {
  const { onChainBatch } = buildRealAnchorRecord();
  const malformed = { schemaVersion: '1.0.0', receiptId: GOLDEN_RECEIPT.receiptId }; // missing batchId/merkleRoot/proof/chain/confirmation
  const fetchImpl = buildFakeServer('dec_1', GOLDEN_RECEIPT, { status: 200, body: malformed });

  await assert.rejects(() =>
    fetchAndVerifyAnchor(client(fetchImpl), 'dec_1', { validatorSet: GOLDEN_VALIDATOR_SET, chainReader: fakeChainReader(onChainBatch) })
  );
});

test('fetchAndVerifyAnchor rejects a tampered receipt with DdnAnchorVerificationError(RECEIPT), even with a structurally valid anchor', async () => {
  const { anchorRecord, onChainBatch } = buildRealAnchorRecord();
  const tamperedReceipt: Record<string, unknown> = {
    ...GOLDEN_RECEIPT,
    consensus: { ...(GOLDEN_RECEIPT.consensus as Record<string, unknown>), outputHash: 'sha256:' + 'f'.repeat(64) },
  };
  const fetchImpl = buildFakeServer('dec_1', tamperedReceipt, { status: 200, body: anchorRecord });

  await assert.rejects(
    () => fetchAndVerifyAnchor(client(fetchImpl), 'dec_1', { validatorSet: GOLDEN_VALIDATOR_SET, chainReader: fakeChainReader(onChainBatch) }),
    (error: unknown) => {
      assert.ok(error instanceof DdnAnchorVerificationError);
      assert.equal(error.verification.failedAt, 'RECEIPT');
      return true;
    }
  );
});

test('fetchAndVerifyAnchor rejects a tampered Merkle proof with DdnAnchorVerificationError(PROOF), even with a genuinely valid receipt', async () => {
  const { anchorRecord, onChainBatch } = buildRealAnchorRecord();
  const tamperedAnchor: AnchorRecordV1 = {
    ...anchorRecord,
    proof: { ...anchorRecord.proof, siblings: [('sha256:' + '0'.repeat(64)) as Sha256Digest] },
  };
  const fetchImpl = buildFakeServer('dec_1', GOLDEN_RECEIPT, { status: 200, body: tamperedAnchor });

  await assert.rejects(
    () => fetchAndVerifyAnchor(client(fetchImpl), 'dec_1', { validatorSet: GOLDEN_VALIDATOR_SET, chainReader: fakeChainReader(onChainBatch) }),
    (error: unknown) => {
      assert.ok(error instanceof DdnAnchorVerificationError);
      assert.equal(error.verification.failedAt, 'PROOF');
      return true;
    }
  );
});
