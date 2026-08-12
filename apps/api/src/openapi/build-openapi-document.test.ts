// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiDocument } from './build-openapi-document.js';

test('buildOpenApiDocument is deterministic', () => {
  assert.deepEqual(buildOpenApiDocument(), buildOpenApiDocument());
});

test('buildOpenApiDocument declares every DDN API v1 route', () => {
  const doc = buildOpenApiDocument() as { paths: Record<string, unknown> };
  assert.deepEqual(Object.keys(doc.paths).sort(), [
    '/healthz',
    '/v1/decisions',
    '/v1/decisions/{decisionId}',
    '/v1/decisions/{decisionId}/anchor',
    '/v1/decisions/{decisionId}/receipt',
    '/v1/decisions/{decisionId}/validators',
    '/v1/policies',
    '/v1/policies/{policyId}/{policyVersion}',
    '/v1/receipts/verify',
  ]);
});

test('buildOpenApiDocument embeds all nine contract schemas with no leftover JSON-Schema-only keywords', () => {
  const doc = buildOpenApiDocument() as { components: { schemas: Record<string, Record<string, unknown>> } };
  const schemas = doc.components.schemas;
  assert.deepEqual(Object.keys(schemas).sort(), [
    'ApiErrorResponseV1',
    'DecisionStatusResponseV1',
    'GetAnchorResponseV1',
    'PolicyDetailResponseV1',
    'PolicyListResponseV1',
    'SubmitDecisionRequestV1',
    'ValidatorProgressResponseV1',
    'VerifyReceiptRequestV1',
    'VerifyReceiptResponseV1',
  ]);
  for (const [name, schema] of Object.entries(schemas)) {
    assert.ok(!('$schema' in schema), `${name} should not carry a $schema keyword into the OpenAPI document`);
    assert.ok(!('$id' in schema), `${name} should not carry a $id keyword into the OpenAPI document`);
  }
});

test('every non-2xx response in the document references ApiErrorResponseV1', () => {
  const doc = buildOpenApiDocument() as {
    paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
  };
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (status.startsWith('2')) continue;
        const ref = response.content?.['application/json']?.schema?.$ref;
        assert.equal(ref, '#/components/schemas/ApiErrorResponseV1', `${method.toUpperCase()} ${path} -> ${status}`);
      }
    }
  }
});

test('POST /v1/decisions requires bearer auth', () => {
  const doc = buildOpenApiDocument() as { paths: { '/v1/decisions': { post: { security: readonly unknown[] } } } };
  assert.deepEqual(doc.paths['/v1/decisions'].post.security, [{ bearerAuth: [] }]);
});

test('GET /healthz requires no auth', () => {
  const doc = buildOpenApiDocument() as { paths: { '/healthz': { get: Record<string, unknown> } } };
  assert.ok(!('security' in doc.paths['/healthz'].get));
});
