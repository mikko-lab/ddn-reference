// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DdnClient, type FetchLike } from './client.js';
import { DdnApiError, DdnNetworkError } from './errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function apiErrorBody(code: string, message: string) {
  return { schemaVersion: '1.0.0', error: { code, message, requestId: 'req-test-1' } };
}

const DECISION_PENDING = {
  schemaVersion: '1.0.0',
  decisionId: 'dec_1',
  status: 'PENDING',
  submittedAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

test('submitDecision parses a well-formed PENDING response', async () => {
  const fetchImpl: FetchLike = async () => jsonResponse(201, DECISION_PENDING);
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });
  const result = await client.submitDecision({
    schemaVersion: '1.0.0',
    policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
    input: {},
    verificationProfileId: 'ddn-wasm-v1',
  });
  assert.deepEqual(result, DECISION_PENDING);
});

test('a 4xx response is surfaced as DdnApiError without retrying', async () => {
  let callCount = 0;
  const fetchImpl: FetchLike = async () => {
    callCount += 1;
    return jsonResponse(403, apiErrorBody('TENANT_MISMATCH', 'nope'));
  };
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl, retryDelayMs: 1 });
  await assert.rejects(
    () => client.getDecision('dec_1'),
    (error: unknown) => {
      assert.ok(error instanceof DdnApiError);
      assert.equal(error.code, 'TENANT_MISMATCH');
      assert.equal(error.httpStatus, 403);
      return true;
    }
  );
  assert.equal(callCount, 1);
});

test('a 500 response is retried and succeeds once the server recovers', async () => {
  let callCount = 0;
  const fetchImpl: FetchLike = async () => {
    callCount += 1;
    if (callCount < 3) return jsonResponse(503, apiErrorBody('INTERNAL_ERROR', 'transient'));
    return jsonResponse(200, DECISION_PENDING);
  };
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl, retryDelayMs: 1 });
  const result = await client.getDecision('dec_1');
  assert.deepEqual(result, DECISION_PENDING);
  assert.equal(callCount, 3);
});

test('a 500 response that never recovers is surfaced as DdnApiError after exhausting retries', async () => {
  let callCount = 0;
  const fetchImpl: FetchLike = async () => {
    callCount += 1;
    return jsonResponse(500, apiErrorBody('INTERNAL_ERROR', 'still broken'));
  };
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl, maxRetries: 2, retryDelayMs: 1 });
  await assert.rejects(
    () => client.getDecision('dec_1'),
    (error: unknown) => {
      assert.ok(error instanceof DdnApiError);
      assert.equal(error.code, 'INTERNAL_ERROR');
      return true;
    }
  );
  assert.equal(callCount, 3); // initial attempt + 2 retries
});

test('a network error is retried and succeeds once connectivity returns', async () => {
  let callCount = 0;
  const fetchImpl: FetchLike = async () => {
    callCount += 1;
    if (callCount < 2) throw new TypeError('fetch failed');
    return jsonResponse(200, DECISION_PENDING);
  };
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl, retryDelayMs: 1 });
  const result = await client.getDecision('dec_1');
  assert.deepEqual(result, DECISION_PENDING);
  assert.equal(callCount, 2);
});

test('a persistent network error is surfaced as DdnNetworkError after exhausting retries', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new TypeError('fetch failed');
  };
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl, maxRetries: 1, retryDelayMs: 1 });
  await assert.rejects(() => client.getDecision('dec_1'), DdnNetworkError);
});

test('requests carry the Bearer service token', async () => {
  let capturedAuth: string | undefined;
  const fetchImpl: FetchLike = async (_url, init) => {
    capturedAuth = (init?.headers as Record<string, string>).authorization;
    return jsonResponse(200, DECISION_PENDING);
  };
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'my-token', fetchImpl });
  await client.getDecision('dec_1');
  assert.equal(capturedAuth, 'Bearer my-token');
});

test('a malformed (schema-invalid) 2xx response throws instead of returning garbage', async () => {
  const fetchImpl: FetchLike = async () => jsonResponse(200, { not: 'a decision status response' });
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });
  await assert.rejects(() => client.getDecision('dec_1'));
});

test('getValidatorProgress parses a well-formed response, including an empty validators array', async () => {
  const body = {
    schemaVersion: '1.0.0',
    decisionId: 'dec_1',
    validators: [{ validatorId: 'sha256:' + 'a'.repeat(64), phase: 'SUCCEEDED', updatedAt: '2026-08-04T00:00:00.000Z', outputHash: 'sha256:' + 'b'.repeat(64) }],
  };
  const fetchImpl: FetchLike = async () => jsonResponse(200, body);
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });
  const result = await client.getValidatorProgress('dec_1');
  assert.deepEqual(result, body);
});

test('getValidatorProgress surfaces a 404 as a typed DdnApiError', async () => {
  const fetchImpl: FetchLike = async () => jsonResponse(404, apiErrorBody('DECISION_NOT_FOUND', 'no decision found for id: dec_1'));
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });
  await assert.rejects(() => client.getValidatorProgress('dec_1'), (error: unknown) => {
    assert.ok(error instanceof DdnApiError);
    assert.equal(error.code, 'DECISION_NOT_FOUND');
    return true;
  });
});

test('getValidatorProgress rejects a malformed 2xx response (e.g. an unknown phase value) instead of returning garbage', async () => {
  const fetchImpl: FetchLike = async () =>
    jsonResponse(200, { schemaVersion: '1.0.0', decisionId: 'dec_1', validators: [{ validatorId: 'sha256:' + 'a'.repeat(64), phase: 'BOGUS', updatedAt: '2026-08-04T00:00:00.000Z' }] });
  const client = new DdnClient({ baseUrl: 'https://api.test', serviceToken: 'tok', fetchImpl });
  await assert.rejects(() => client.getValidatorProgress('dec_1'));
});
