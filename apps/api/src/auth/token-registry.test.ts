// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiConfig } from '../config.js';
import { findServiceTokenPrincipal } from './token-registry.js';

function configWithTokens(tokens: ApiConfig['serviceTokens']): ApiConfig {
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
    serviceTokens: tokens,
  };
}

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

const config = configWithTokens([
  { token: TOKEN_A, tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit', 'decision:read'] },
  { token: TOKEN_B, tokenId: 'tok_b', tenantId: 'tenant-b', roles: ['policy:read'] },
]);

test('findServiceTokenPrincipal returns the matching principal', () => {
  const principal = findServiceTokenPrincipal(config, TOKEN_A);
  assert.deepEqual(principal, { tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit', 'decision:read'] });
});

test('findServiceTokenPrincipal returns undefined for an unknown token', () => {
  assert.equal(findServiceTokenPrincipal(config, 'c'.repeat(32)), undefined);
});

test('findServiceTokenPrincipal returns undefined for a token that is a prefix of a real one', () => {
  assert.equal(findServiceTokenPrincipal(config, TOKEN_A.slice(0, 16)), undefined);
});

test('findServiceTokenPrincipal returns undefined for the empty string', () => {
  assert.equal(findServiceTokenPrincipal(config, ''), undefined);
});

test('findServiceTokenPrincipal distinguishes tokens of different configured entries', () => {
  const principal = findServiceTokenPrincipal(config, TOKEN_B);
  assert.deepEqual(principal, { tokenId: 'tok_b', tenantId: 'tenant-b', roles: ['policy:read'] });
});
