// SPDX-License-Identifier: Apache-2.0
// Uses the committed Milestone 4 golden vectors (a real, validly-signed
// DecisionReceiptV1 and its matching ValidatorSetV1) so this test proves
// submitWaitAndVerify's own logic -- polling, terminal-state handling,
// and, critically, that it genuinely calls @ddn/receipt-sdk's
// verifyDecisionReceipt and rejects a tampered receipt -- without needing
// the ddn-validator binary or a running server. The full external-client
// proof against a real HTTP server belongs to the external-client suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ValidatorSetV1 } from '@ddn/receipt-sdk';
import { DdnClient, type FetchLike } from './client.js';
import { DdnDecisionFailedError, DdnReceiptVerificationError, DdnTimeoutError } from './errors.js';
import { submitWaitAndVerify } from './submit-wait-and-verify.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VECTORS_DIR = join(REPO_ROOT, 'packages/test-vectors/vectors/decision-receipt-v1');

function readJson(filename: string): unknown {
  return JSON.parse(readFileSync(join(VECTORS_DIR, filename), 'utf8'));
}

const GOLDEN_RECEIPT = readJson('decision-receipt.json') as Record<string, unknown>;
const GOLDEN_VALIDATOR_SET = readJson('validator-set.json') as ValidatorSetV1;

const SUBMIT_REQUEST = {
  schemaVersion: '1.0.0',
  policy: { policyId: 'negotiation-reference', policyVersion: '1.0.0' },
  input: {},
  verificationProfileId: 'ddn-wasm-v1',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface FakeServerOptions {
  readonly decisionId: string;
  readonly pendingPolls: number;
  readonly terminal: Record<string, unknown>;
  readonly receipt?: unknown;
}

function buildFakeServer(options: FakeServerOptions): FetchLike {
  let pollCount = 0;
  const now = '2026-08-03T00:00:00.000Z';
  return async (url) => {
    const path = new URL(url as string).pathname;
    if (path === '/v1/decisions') {
      return jsonResponse(201, {
        schemaVersion: '1.0.0',
        decisionId: options.decisionId,
        status: 'PENDING',
        submittedAt: now,
        updatedAt: now,
      });
    }
    if (path === `/v1/decisions/${options.decisionId}/receipt`) {
      return jsonResponse(200, options.receipt ?? GOLDEN_RECEIPT);
    }
    if (path === `/v1/decisions/${options.decisionId}`) {
      pollCount += 1;
      if (pollCount <= options.pendingPolls) {
        return jsonResponse(200, {
          schemaVersion: '1.0.0',
          decisionId: options.decisionId,
          status: 'RUNNING',
          submittedAt: now,
          updatedAt: now,
        });
      }
      return jsonResponse(200, options.terminal);
    }
    throw new Error(`unexpected path in fake server: ${path}`);
  };
}

test('submitWaitAndVerify resolves with a passing verification for a real, validly-signed receipt', async () => {
  const signedResults = GOLDEN_RECEIPT.signedResults as readonly { result: { output: Record<string, unknown> } }[];
  const expectedOutput = signedResults[0]?.result.output;
  const finalizedAt = '2026-08-03T00:00:05.000Z';
  const fetchImpl = buildFakeServer({
    decisionId: 'dec_golden_1',
    pendingPolls: 1,
    terminal: {
      schemaVersion: '1.0.0',
      decisionId: 'dec_golden_1',
      status: 'FINALIZED',
      result: expectedOutput,
      verification: {
        receiptId: GOLDEN_RECEIPT.receiptId,
        validatorSetId: GOLDEN_VALIDATOR_SET.validatorSetId,
        matchingValidators: 3,
        requiredQuorum: 2,
        policyHash: 'sha256:62bb7ca911c6257ec4bea116090b8d0c8607e7d2bbbbf430805f58270c68280a',
        profileHash: 'sha256:bed8e81c5293be85b076cb03e738c339f3f1f5324bda7382d954b6dacbf169bd',
        inputHash: 'sha256:c74a8b124bf200331d9021c0531f15b97f99cddf4f6c510f77e2953c2b9d078f',
        outputHash: 'sha256:46c563ca501d1743b2cec8c3f244890976ddc25b929cdfb2ebf470ce4ceb5010',
        executionHash: 'sha256:4022569814727cd4c38c4cf3cdf2722eb19fe01a6ebc99e3b7fd0e4f49b493b4',
      },
      submittedAt: '2026-08-03T00:00:00.000Z',
      finalizedAt,
    },
  });
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });

  const result = await submitWaitAndVerify(client, SUBMIT_REQUEST, { validatorSet: GOLDEN_VALIDATOR_SET, pollIntervalMs: 1 });

  assert.equal(result.decisionId, 'dec_golden_1');
  assert.equal(result.verification.ok, true);
  assert.equal(result.receipt.receiptId, GOLDEN_RECEIPT.receiptId);
  assert.deepEqual(result.result, expectedOutput);
});

test('submitWaitAndVerify rejects a tampered receipt with DdnReceiptVerificationError, even though the server claims FINALIZED', async () => {
  const tamperedReceipt: Record<string, unknown> = {
    ...GOLDEN_RECEIPT,
    consensus: { ...(GOLDEN_RECEIPT.consensus as Record<string, unknown>), outputHash: 'sha256:' + 'f'.repeat(64) },
  };
  const finalizedAt = '2026-08-03T00:00:05.000Z';
  const fetchImpl = buildFakeServer({
    decisionId: 'dec_tampered_1',
    pendingPolls: 0,
    receipt: tamperedReceipt,
    terminal: {
      schemaVersion: '1.0.0',
      decisionId: 'dec_tampered_1',
      status: 'FINALIZED',
      result: {},
      verification: {
        receiptId: tamperedReceipt.receiptId,
        validatorSetId: GOLDEN_VALIDATOR_SET.validatorSetId,
        matchingValidators: 3,
        requiredQuorum: 2,
        policyHash: 'sha256:' + 'a'.repeat(64),
        profileHash: 'sha256:' + 'b'.repeat(64),
        inputHash: 'sha256:' + 'c'.repeat(64),
        outputHash: 'sha256:' + 'd'.repeat(64),
        executionHash: 'sha256:' + 'e'.repeat(64),
      },
      submittedAt: '2026-08-03T00:00:00.000Z',
      finalizedAt,
    },
  });
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });

  await assert.rejects(
    () => submitWaitAndVerify(client, SUBMIT_REQUEST, { validatorSet: GOLDEN_VALIDATOR_SET, pollIntervalMs: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof DdnReceiptVerificationError);
      assert.equal(error.verification.ok, false);
      return true;
    }
  );
});

test('submitWaitAndVerify throws DdnDecisionFailedError when the decision resolves to NO_QUORUM', async () => {
  const fetchImpl = buildFakeServer({
    decisionId: 'dec_no_quorum_1',
    pendingPolls: 0,
    terminal: {
      schemaVersion: '1.0.0',
      decisionId: 'dec_no_quorum_1',
      status: 'NO_QUORUM',
      error: { code: 'NO_QUORUM', message: 'insufficient matching validator results' },
      submittedAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:01.000Z',
    },
  });
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });

  await assert.rejects(
    () => submitWaitAndVerify(client, SUBMIT_REQUEST, { validatorSet: GOLDEN_VALIDATOR_SET, pollIntervalMs: 1 }),
    DdnDecisionFailedError
  );
});

test('submitWaitAndVerify throws DdnTimeoutError when the decision never leaves RUNNING before the deadline', async () => {
  const fetchImpl = buildFakeServer({
    decisionId: 'dec_stuck_1',
    pendingPolls: Number.POSITIVE_INFINITY,
    terminal: { schemaVersion: '1.0.0', decisionId: 'dec_stuck_1', status: 'RUNNING', submittedAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z' },
  });
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });

  await assert.rejects(
    () => submitWaitAndVerify(client, SUBMIT_REQUEST, { validatorSet: GOLDEN_VALIDATOR_SET, pollIntervalMs: 1, timeoutMs: 20 }),
    DdnTimeoutError
  );
});
