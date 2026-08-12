// SPDX-License-Identifier: Apache-2.0
// Tenant isolation for POST /v1/decisions: a service token belongs to
// exactly one tenant, and input.tenantId is reconciled against it BEFORE
// the stricter negotiation-input-v1.schema.json check runs (that schema
// requires tenantId, so by the time it sees the input, tenantId is always
// present and always trustworthy). A client cannot submit "as" a
// different tenant just by setting the field -- see docs/api-v1.md.

import { ApiError } from '../errors/api-error.js';
import type { ServiceTokenPrincipal } from './types.js';

export function reconcileTenantId(
  input: Record<string, unknown>,
  principal: ServiceTokenPrincipal
): Record<string, unknown> {
  if (!('tenantId' in input) || input.tenantId === undefined) {
    return { ...input, tenantId: principal.tenantId };
  }
  if (input.tenantId !== principal.tenantId) {
    throw new ApiError('TENANT_MISMATCH', 'input.tenantId does not match the authenticated tenant');
  }
  return input;
}
