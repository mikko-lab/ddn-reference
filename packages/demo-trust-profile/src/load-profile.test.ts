// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildValidatorSetV1 } from '@ddn/receipt-sdk';
import { assertProfileIntegrity, loadBundledTrustedDemoProfile } from './load-profile.js';
import { TrustedDemoProfileError, type TrustedDemoProfileV1 } from './trusted-demo-profile.js';

test('loadBundledTrustedDemoProfile loads and integrity-checks the real committed profile', () => {
  const profile = loadBundledTrustedDemoProfile();
  assert.equal(profile.schemaVersion, '1.0.0');
  assert.equal(profile.chain.chainId, 31337);
  assert.match(profile.chain.contractAddress, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(profile.validatorSet.validators.length, 3);
});

test('assertProfileIntegrity accepts a profile whose validatorSetId matches its own content', () => {
  const validatorSet = buildValidatorSetV1({
    schemaVersion: '1.0.0',
    threshold: 2,
    publicKeys: ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)],
  });
  const profile: TrustedDemoProfileV1 = { schemaVersion: '1.0.0', validatorSet, chain: { chainId: 31337, contractAddress: `0x${'5'.repeat(40)}` } };
  assert.doesNotThrow(() => assertProfileIntegrity(profile));
});

test('assertProfileIntegrity rejects a profile whose validatorSetId was tampered with', () => {
  const validatorSet = buildValidatorSetV1({
    schemaVersion: '1.0.0',
    threshold: 2,
    publicKeys: ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)],
  });
  const tampered: TrustedDemoProfileV1 = {
    schemaVersion: '1.0.0',
    validatorSet: { ...validatorSet, validatorSetId: `sha256:${'0'.repeat(64)}` },
    chain: { chainId: 31337, contractAddress: `0x${'5'.repeat(40)}` },
  };
  assert.throws(() => assertProfileIntegrity(tampered), TrustedDemoProfileError);
});
