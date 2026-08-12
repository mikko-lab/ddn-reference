// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../errors/api-error.js';
import type { ServiceTokenPrincipal } from './types.js';
import { reconcileTenantId } from './tenant-context.js';

const principal: ServiceTokenPrincipal = { tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit'] };

test('reconcileTenantId injects the principal tenantId when absent', () => {
  const result = reconcileTenantId({ vehicleId: 'v1' }, principal);
  assert.deepEqual(result, { vehicleId: 'v1', tenantId: 'tenant-a' });
});

test('reconcileTenantId accepts input.tenantId when it matches the principal', () => {
  const result = reconcileTenantId({ tenantId: 'tenant-a', vehicleId: 'v1' }, principal);
  assert.deepEqual(result, { tenantId: 'tenant-a', vehicleId: 'v1' });
});

test('reconcileTenantId rejects input.tenantId when it conflicts with the principal', () => {
  assert.throws(
    () => reconcileTenantId({ tenantId: 'tenant-b' }, principal),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'TENANT_MISMATCH');
      return true;
    }
  );
});

test('reconcileTenantId treats an explicit undefined tenantId as absent', () => {
  const result = reconcileTenantId({ tenantId: undefined }, principal);
  assert.deepEqual(result, { tenantId: 'tenant-a' });
});
