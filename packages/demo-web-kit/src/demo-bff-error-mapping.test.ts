// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DdnApiError, DdnNetworkError } from '@ddn/client-sdk';
import { mapUpstreamError } from './demo-bff-error-mapping.js';

function apiError(code: string, httpStatus: number): DdnApiError {
  return new DdnApiError({ schemaVersion: '1.0.0', error: { code, message: 'upstream detail nobody should see', requestId: 'req-internal-123' } }, httpStatus);
}

test('mapUpstreamError maps DECISION_NOT_FOUND to a generic 404 NOT_FOUND, never forwarding the upstream message', () => {
  const mapped = mapUpstreamError(apiError('DECISION_NOT_FOUND', 404));
  assert.equal(mapped.status, 404);
  assert.equal(mapped.dto.error.code, 'NOT_FOUND');
  assert.doesNotMatch(mapped.dto.error.message, /upstream detail/);
});

test('mapUpstreamError maps UNAUTHORIZED to 503 SERVICE_UNAVAILABLE (the demo token is broken, not the visitor request)', () => {
  const mapped = mapUpstreamError(apiError('UNAUTHORIZED', 401));
  assert.equal(mapped.status, 503);
  assert.equal(mapped.dto.error.code, 'SERVICE_UNAVAILABLE');
});

test('mapUpstreamError maps FORBIDDEN to 503 SERVICE_UNAVAILABLE', () => {
  const mapped = mapUpstreamError(apiError('FORBIDDEN', 403));
  assert.equal(mapped.status, 503);
  assert.equal(mapped.dto.error.code, 'SERVICE_UNAVAILABLE');
});

test('mapUpstreamError maps an unrecognized ApiError code to 502 UPSTREAM_ERROR', () => {
  const mapped = mapUpstreamError(apiError('INTERNAL_ERROR', 500));
  assert.equal(mapped.status, 502);
  assert.equal(mapped.dto.error.code, 'UPSTREAM_ERROR');
});

test('mapUpstreamError maps a network error to 502 UPSTREAM_ERROR without forwarding its message', () => {
  const mapped = mapUpstreamError(new DdnNetworkError('connect ECONNREFUSED 127.0.0.1:9999'));
  assert.equal(mapped.status, 502);
  assert.equal(mapped.dto.error.code, 'UPSTREAM_ERROR');
  assert.doesNotMatch(mapped.dto.error.message, /ECONNREFUSED/);
});

test('mapUpstreamError maps a totally unexpected thrown value to 502 UPSTREAM_ERROR', () => {
  const mapped = mapUpstreamError('a plain string, not even an Error');
  assert.equal(mapped.status, 502);
  assert.equal(mapped.dto.error.code, 'UPSTREAM_ERROR');
});
