// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildValidatorSetV1 } from '@ddn/receipt-sdk';
import { parseTrustedDemoProfileV1, TrustedDemoProfileError, type TrustedDemoProfileV1 } from './trusted-demo-profile.js';

function validProfile(): TrustedDemoProfileV1 {
  const validatorSet = buildValidatorSetV1({
    schemaVersion: '1.0.0',
    threshold: 2,
    publicKeys: ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)],
  });
  return { schemaVersion: '1.0.0', validatorSet, chain: { chainId: 31337, contractAddress: `0x${'5'.repeat(40)}` } };
}

test('parseTrustedDemoProfileV1 accepts a well-formed profile and round-trips it', () => {
  const profile = validProfile();
  const parsed = parseTrustedDemoProfileV1(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(parsed, profile);
});

test('parseTrustedDemoProfileV1 rejects an unrecognized top-level field', () => {
  const withExtra = { ...validProfile(), extra: 'nope' };
  assert.throws(() => parseTrustedDemoProfileV1(withExtra), TrustedDemoProfileError);
});

test('parseTrustedDemoProfileV1 rejects an unrecognized chain field', () => {
  const profile = validProfile();
  const tampered = { ...profile, chain: { ...profile.chain, extra: 'nope' } };
  assert.throws(() => parseTrustedDemoProfileV1(tampered), TrustedDemoProfileError);
});

test('parseTrustedDemoProfileV1 rejects a wrong schemaVersion', () => {
  const tampered = { ...validProfile(), schemaVersion: '2.0.0' };
  assert.throws(() => parseTrustedDemoProfileV1(tampered), TrustedDemoProfileError);
});

test('parseTrustedDemoProfileV1 rejects a non-positive-integer chainId', () => {
  const profile = validProfile();
  for (const badChainId of [0, -1, 1.5, '31337']) {
    const tampered = { ...profile, chain: { ...profile.chain, chainId: badChainId } };
    assert.throws(() => parseTrustedDemoProfileV1(tampered), TrustedDemoProfileError);
  }
});

test('parseTrustedDemoProfileV1 rejects a malformed contractAddress', () => {
  const profile = validProfile();
  for (const badAddress of ['not-an-address', '0x123', `${'5'.repeat(40)}`, `0x${'g'.repeat(40)}`]) {
    const tampered = { ...profile, chain: { ...profile.chain, contractAddress: badAddress } };
    assert.throws(() => parseTrustedDemoProfileV1(tampered), TrustedDemoProfileError);
  }
});

test('parseTrustedDemoProfileV1 surfaces an invalid validatorSet as a wrapped TrustedDemoProfileError', () => {
  const profile = validProfile();
  const tampered = { ...profile, validatorSet: { ...profile.validatorSet, extraField: 'nope' } };
  assert.throws(() => parseTrustedDemoProfileV1(tampered), TrustedDemoProfileError);
});
