// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReferenceEnvConfig } from './reference-bff-env';

test('readReferenceEnvConfig returns undefined when nothing is set (fail closed)', () => {
  assert.equal(readReferenceEnvConfig({}), undefined);
});

test('readReferenceEnvConfig returns the config once both vars are set', () => {
  const config = readReferenceEnvConfig({ DDN_API_BASE_URL: 'http://127.0.0.1:4000', DDN_DEMO_REFERENCE_SERVICE_TOKEN: 'a-token' });
  assert.deepEqual(config, { baseUrl: 'http://127.0.0.1:4000', serviceToken: 'a-token' });
});

test('readReferenceEnvConfig never accepts the explorer token as a fallback', () => {
  const withOtherTokens = {
    DDN_API_BASE_URL: 'http://127.0.0.1:4000',
    DDN_DEMO_SERVICE_TOKEN: 'explorer-token',
  };
  assert.equal(readReferenceEnvConfig(withOtherTokens), undefined);
});

test('readReferenceEnvConfig fails closed when only one of the two vars is set', () => {
  assert.equal(readReferenceEnvConfig({ DDN_API_BASE_URL: 'http://127.0.0.1:4000' }), undefined);
  assert.equal(readReferenceEnvConfig({ DDN_DEMO_REFERENCE_SERVICE_TOKEN: 'a-token' }), undefined);
});
