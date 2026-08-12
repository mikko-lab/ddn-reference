// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../errors/api-error.js';
import { loadVerificationProfile, requireMatchingVerificationProfile, VerificationProfileError } from './verification-profile.js';

async function writeProfile(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-verification-profile-'));
  const path = join(dir, 'profile.json');
  await writeFile(path, JSON.stringify(content));
  return path;
}

test('loadVerificationProfile reads the profileId field', async () => {
  const path = await writeProfile({ profileId: 'ddn-wasm-v1', runtime: 'wasmtime' });
  const profile = loadVerificationProfile(path);
  assert.equal(profile.profileId, 'ddn-wasm-v1');
  assert.equal(profile.profilePath, path);
});

test('loadVerificationProfile rejects a file missing profileId', async () => {
  const path = await writeProfile({ runtime: 'wasmtime' });
  assert.throws(() => loadVerificationProfile(path), VerificationProfileError);
});

test('loadVerificationProfile rejects invalid JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-verification-profile-'));
  const path = join(dir, 'profile.json');
  await writeFile(path, '{not json');
  assert.throws(() => loadVerificationProfile(path), VerificationProfileError);
});

test('requireMatchingVerificationProfile accepts a matching id', async () => {
  const path = await writeProfile({ profileId: 'ddn-wasm-v1' });
  const profile = loadVerificationProfile(path);
  assert.doesNotThrow(() => requireMatchingVerificationProfile(profile, 'ddn-wasm-v1'));
});

test('requireMatchingVerificationProfile rejects a mismatched id with UNKNOWN_VERIFICATION_PROFILE', async () => {
  const path = await writeProfile({ profileId: 'ddn-wasm-v1' });
  const profile = loadVerificationProfile(path);
  assert.throws(
    () => requireMatchingVerificationProfile(profile, 'some-other-profile'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'UNKNOWN_VERIFICATION_PROFILE');
      return true;
    }
  );
});
