// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildValidatorSetV1 } from '@ddn/receipt-sdk';
import { loadTrustedValidatorSet, ValidatorSetLoadError } from './validator-set-loader.js';

const PUBLIC_KEYS = [
  'ae97d90d2a92da0254825e8fd1bf2ad3096a7ac5bcf67a38e61b22a66a97381e',
  'cb3065d80f1e2ced6c8c8bdf66cb7809fa384fef4566de4c9b4110919dc23e4b',
  '95e8bb3978993937bb170e0120be891861b8d90c7430c470909a4f63e83d4180',
];

test('loadTrustedValidatorSet loads a well-formed, self-consistent validator set', async () => {
  const validatorSet = buildValidatorSetV1({ schemaVersion: '1.0.0', threshold: 2, publicKeys: PUBLIC_KEYS });
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-validator-set-'));
  const path = join(dir, 'validator-set.json');
  await writeFile(path, JSON.stringify(validatorSet));
  const loaded = await loadTrustedValidatorSet(path);
  assert.equal(loaded.validatorSetId, validatorSet.validatorSetId);
});

test('loadTrustedValidatorSet rejects a file whose validatorSetId does not match its own content', async () => {
  const validatorSet = buildValidatorSetV1({ schemaVersion: '1.0.0', threshold: 2, publicKeys: PUBLIC_KEYS });
  const tampered = { ...validatorSet, threshold: 3 };
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-validator-set-'));
  const path = join(dir, 'validator-set.json');
  await writeFile(path, JSON.stringify(tampered));
  await assert.rejects(() => loadTrustedValidatorSet(path), ValidatorSetLoadError);
});
