// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../errors/api-error.js';
import { loadPolicyRegistry, PolicyRegistryError, requireActivePolicy } from './policy-registry.js';

async function writeRegistry(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-policy-registry-'));
  const path = join(dir, 'registry.json');
  await writeFile(path, JSON.stringify(content));
  return path;
}

test('loadPolicyRegistry resolves policyPackagePath relative to the registry file directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-policy-registry-'));
  await mkdir(join(dir, 'negotiation-v1', 'package'), { recursive: true });
  const registryPath = join(dir, 'registry.json');
  await writeFile(
    registryPath,
    JSON.stringify({ schemaVersion: '1.0.0', policies: [{ policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: 'negotiation-v1/package', status: 'ACTIVE' }] })
  );
  const registry = loadPolicyRegistry(registryPath);
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0]?.policyPackagePath, join(dir, 'negotiation-v1', 'package'));
});

test('loadPolicyRegistry rejects a duplicate (policyId, policyVersion) pair', async () => {
  const path = await writeRegistry({
    policies: [
      { policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: 'a', status: 'ACTIVE' },
      { policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: 'b', status: 'ACTIVE' },
    ],
  });
  assert.throws(() => loadPolicyRegistry(path), PolicyRegistryError);
});

test('loadPolicyRegistry rejects an invalid status value', async () => {
  const path = await writeRegistry({
    policies: [{ policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: 'a', status: 'PENDING' }],
  });
  assert.throws(() => loadPolicyRegistry(path), PolicyRegistryError);
});

test('loadPolicyRegistry rejects a file without a "policies" array', async () => {
  const path = await writeRegistry({ schemaVersion: '1.0.0' });
  assert.throws(() => loadPolicyRegistry(path), PolicyRegistryError);
});

test('requireActivePolicy returns the matching ACTIVE entry', async () => {
  const path = await writeRegistry({
    policies: [{ policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: 'a', status: 'ACTIVE' }],
  });
  const registry = loadPolicyRegistry(path);
  const entry = requireActivePolicy(registry, { policyId: 'negotiation-v1', policyVersion: '1.0.0' });
  assert.equal(entry.policyId, 'negotiation-v1');
});

test('requireActivePolicy rejects an unregistered (policyId, policyVersion) pair with POLICY_NOT_FOUND', async () => {
  const path = await writeRegistry({ policies: [] });
  const registry = loadPolicyRegistry(path);
  assert.throws(
    () => requireActivePolicy(registry, { policyId: 'unknown-policy', policyVersion: '1.0.0' }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'POLICY_NOT_FOUND');
      return true;
    }
  );
});

test('requireActivePolicy rejects an INACTIVE policy with POLICY_NOT_ACTIVE', async () => {
  const path = await writeRegistry({
    policies: [{ policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: 'a', status: 'INACTIVE' }],
  });
  const registry = loadPolicyRegistry(path);
  assert.throws(
    () => requireActivePolicy(registry, { policyId: 'negotiation-v1', policyVersion: '1.0.0' }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'POLICY_NOT_ACTIVE');
      return true;
    }
  );
});
