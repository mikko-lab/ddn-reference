// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sha256Digest } from '@ddn/crypto';
import { Bytes32ConversionError, bytes32ToSha256Digest, sha256DigestToBytes32 } from './bytes32.js';

test('round-trips an arbitrary digest through bytes32 and back', () => {
  const digest = ('sha256:' + '3f'.repeat(32)) as Sha256Digest;
  const bytes32 = sha256DigestToBytes32(digest);
  assert.equal(bytes32, '0x' + '3f'.repeat(32));
  assert.equal(bytes32ToSha256Digest(bytes32), digest);
});

test('round-trips the all-zero digest', () => {
  const digest = ('sha256:' + '0'.repeat(64)) as Sha256Digest;
  assert.equal(bytes32ToSha256Digest(sha256DigestToBytes32(digest)), digest);
});

test('round-trips the all-f digest', () => {
  const digest = ('sha256:' + 'f'.repeat(64)) as Sha256Digest;
  assert.equal(bytes32ToSha256Digest(sha256DigestToBytes32(digest)), digest);
});

test('bytes32ToSha256Digest lowercases mixed-case hex', () => {
  const value = '0x' + 'AB'.repeat(32);
  assert.equal(bytes32ToSha256Digest(value), 'sha256:' + 'ab'.repeat(32));
});

test('sha256DigestToBytes32 rejects a malformed digest', () => {
  assert.throws(() => sha256DigestToBytes32('not-a-digest' as Sha256Digest), Bytes32ConversionError);
});

test('bytes32ToSha256Digest rejects a malformed hex string', () => {
  assert.throws(() => bytes32ToSha256Digest('0xnothex'), Bytes32ConversionError);
  assert.throws(() => bytes32ToSha256Digest('deadbeef'), Bytes32ConversionError);
});
