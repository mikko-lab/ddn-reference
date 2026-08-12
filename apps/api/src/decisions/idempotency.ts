// SPDX-License-Identifier: Apache-2.0
// idempotencyRequestHash = SHA256(canonical {domain: "DDN_API_DECISION_REQUEST_V1",
// value: {tenantId, policy, input, verificationProfileId}}). Two submissions
// with the same tenant, policy, input, and verification profile are the
// same logical request and resolve to the same decision, regardless of
// decisionId -- see decision-repository.ts's createOrGetByIdempotencyKey.

import { assertCanonicalJsonValue } from '@ddn/canonical-json';
import { hashCanonicalJson, type Sha256Digest } from '@ddn/crypto';
import type { PolicyRefV1 } from '@ddn/schemas';

const IDEMPOTENCY_DOMAIN = 'DDN_API_DECISION_REQUEST_V1';

export interface IdempotencyKeyInputV1 {
  readonly tenantId: string;
  readonly policy: PolicyRefV1;
  readonly input: Record<string, unknown>;
  readonly verificationProfileId: string;
}

/** Precondition: `params.input` has already passed policy input schema
 * validation (e.g. validateNegotiationInputV1), so it is guaranteed to
 * conform to the canonical JSON data profile -- this must run after that
 * check, not before, or a non-conforming input throws CanonicalJsonError
 * instead of the intended ApiError('INVALID_REQUEST'). */
export function computeIdempotencyRequestHash(params: IdempotencyKeyInputV1): Sha256Digest {
  const value: Record<string, unknown> = {
    tenantId: params.tenantId,
    policy: { policyId: params.policy.policyId, policyVersion: params.policy.policyVersion },
    input: params.input,
    verificationProfileId: params.verificationProfileId,
  };
  assertCanonicalJsonValue(value);
  return hashCanonicalJson(IDEMPOTENCY_DOMAIN, value);
}
