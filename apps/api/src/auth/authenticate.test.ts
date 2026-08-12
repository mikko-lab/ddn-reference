// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.js';
import { ApiError } from '../errors/api-error.js';
import { getPrincipal, requireAuth } from './authenticate.js';

const TOKEN = 't'.repeat(32);

function config(): ApiConfig {
  return {
    host: '127.0.0.1',
    port: 4000,
    maxRequestBytes: 20_000,
    decisionTimeoutMs: 30_000,
    maxConcurrentDecisions: 50,
    corsAllowedOrigins: ['https://example.test'],
    validatorBinaryPath: '/bin/ddn-validator',
    policyRegistryPath: '/policies/registry.json',
    executionProfilePath: '/policies/profile.json',
    validatorSetPath: '/policies/validator-set.json',
    validatorInstances: [],
    serviceTokens: [{ token: TOKEN, tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit'] }],
  };
}

function fakeRequest(authorization: string | undefined): FastifyRequest {
  return { headers: { authorization } } as unknown as FastifyRequest;
}

async function expectApiError(fn: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, code);
    return true;
  });
}

test('requireAuth accepts a valid token with the required role and attaches the principal', async () => {
  const req = fakeRequest(`Bearer ${TOKEN}`);
  await requireAuth(config(), ['decision:submit'])(req);
  assert.deepEqual(getPrincipal(req), { tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit'] });
});

test('requireAuth rejects a missing Authorization header', async () => {
  await expectApiError(() => requireAuth(config(), ['decision:submit'])(fakeRequest(undefined)), 'UNAUTHORIZED');
});

test('requireAuth rejects a header without the Bearer prefix', async () => {
  await expectApiError(() => requireAuth(config(), ['decision:submit'])(fakeRequest(TOKEN)), 'UNAUTHORIZED');
});

test('requireAuth rejects an empty bearer token', async () => {
  await expectApiError(() => requireAuth(config(), ['decision:submit'])(fakeRequest('Bearer ')), 'UNAUTHORIZED');
});

test('requireAuth rejects an unknown token', async () => {
  await expectApiError(() => requireAuth(config(), ['decision:submit'])(fakeRequest(`Bearer ${'x'.repeat(32)}`)), 'UNAUTHORIZED');
});

test('requireAuth rejects a valid token missing a required role', async () => {
  await expectApiError(() => requireAuth(config(), ['policy:read'])(fakeRequest(`Bearer ${TOKEN}`)), 'FORBIDDEN');
});

test('getPrincipal throws if called before requireAuth ran', () => {
  assert.throws(() => getPrincipal(fakeRequest(undefined)), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'INTERNAL_ERROR');
    return true;
  });
});
