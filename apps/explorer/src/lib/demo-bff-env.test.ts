// SPDX-License-Identifier: Apache-2.0
// TEST-ONLY / NEVER USE IN PRODUCTION.
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDemoBffEnvConfig } from './demo-bff-env';

test('readDemoBffEnvConfig returns undefined when both env vars are missing (fail closed)', () => {
  assert.equal(readDemoBffEnvConfig({}), undefined);
});

test('readDemoBffEnvConfig returns undefined when only DDN_API_BASE_URL is set', () => {
  assert.equal(readDemoBffEnvConfig({ DDN_API_BASE_URL: 'http://127.0.0.1:4000' }), undefined);
});

test('readDemoBffEnvConfig returns undefined when only DDN_DEMO_SERVICE_TOKEN is set', () => {
  assert.equal(readDemoBffEnvConfig({ DDN_DEMO_SERVICE_TOKEN: 'a-token' }), undefined);
});

test('readDemoBffEnvConfig returns both values once both are set', () => {
  const config = readDemoBffEnvConfig({ DDN_API_BASE_URL: 'http://127.0.0.1:4000', DDN_DEMO_SERVICE_TOKEN: 'a-token' });
  assert.deepEqual(config, { baseUrl: 'http://127.0.0.1:4000', serviceToken: 'a-token' });
});

test('readDemoBffEnvConfig treats an empty-string env var the same as missing', () => {
  assert.equal(readDemoBffEnvConfig({ DDN_API_BASE_URL: '', DDN_DEMO_SERVICE_TOKEN: 'a-token' }), undefined);
});

// Cross-token-isolation tests prove that the public explorer BFF reads only
// its own scoped credential. Neither test below tries to judge
// whether any of these token strings is semantically valid -- that is
// entirely apps/api's own job (DDN_SERVICE_TOKENS, checked upstream over
// a real HTTP call). What's proven here is narrower and purely local:
// which key readDemoBffEnvConfig picks, and that no fallback between
// keys exists to get that pick wrong.
test('readDemoBffEnvConfig selects exactly its own DDN_DEMO_SERVICE_TOKEN when another scoped token is present', () => {
  const multipleTokensPresent = {
    DDN_API_BASE_URL: 'http://127.0.0.1:4000',
    DDN_DEMO_SERVICE_TOKEN: 'the-real-demo-bff-token',
    DDN_DEMO_REFERENCE_SERVICE_TOKEN: 'a-completely-different-reference-token',
  };
  const config = readDemoBffEnvConfig(multipleTokensPresent);
  assert.deepEqual(config, { baseUrl: multipleTokensPresent.DDN_API_BASE_URL, serviceToken: 'the-real-demo-bff-token' });
});

test('readDemoBffEnvConfig never accepts the reference service token as a fallback when its own is missing', () => {
  const withOnlyOtherTokens = {
    DDN_API_BASE_URL: 'http://127.0.0.1:4000',
    DDN_DEMO_REFERENCE_SERVICE_TOKEN: 'reference-token-should-not-satisfy-demo-bff-config',
  };
  assert.equal(readDemoBffEnvConfig(withOnlyOtherTokens), undefined);
});
