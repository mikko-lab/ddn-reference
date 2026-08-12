// SPDX-License-Identifier: Apache-2.0
// The one error shape every DDN API response uses. See docs/api-v1.md
// and docs/api-security-model.md for what each code means and what is
// deliberately never included in a response (stack traces, file paths,
// private key paths, validator stderr, bearer tokens, full policy input).

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'INVALID_REQUEST'
  | 'REQUEST_TOO_LARGE'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'POLICY_NOT_FOUND'
  | 'POLICY_NOT_ACTIVE'
  | 'UNKNOWN_VERIFICATION_PROFILE'
  | 'DECISION_NOT_FOUND'
  | 'DECISION_STATE_CONFLICT'
  | 'NO_QUORUM'
  | 'RECEIPT_NOT_AVAILABLE'
  | 'ANCHOR_NOT_AVAILABLE'
  | 'RECEIPT_SELF_VERIFICATION_FAILED'
  | 'COORDINATOR_TIMEOUT'
  | 'COORDINATOR_FAILED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  TENANT_MISMATCH: 403,
  INVALID_REQUEST: 400,
  REQUEST_TOO_LARGE: 413,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  POLICY_NOT_FOUND: 404,
  POLICY_NOT_ACTIVE: 409,
  UNKNOWN_VERIFICATION_PROFILE: 400,
  DECISION_NOT_FOUND: 404,
  DECISION_STATE_CONFLICT: 409,
  NO_QUORUM: 200, // reported as decision status, not a request failure
  RECEIPT_NOT_AVAILABLE: 409,
  ANCHOR_NOT_AVAILABLE: 409,
  RECEIPT_SELF_VERIFICATION_FAILED: 500,
  COORDINATOR_TIMEOUT: 504,
  COORDINATOR_FAILED: 502,
  INTERNAL_ERROR: 500,
};

/** Used by error-handler.ts to map an @ddn/schemas ApiSchemaValidationError
 * (a different class, thrown by parseSubmitDecisionRequestV1 et al.) onto
 * the same HTTP status this class would use for the same code string. */
export function httpStatusForCode(code: string): number {
  return (STATUS_BY_CODE as Record<string, number | undefined>)[code] ?? 500;
}

export interface ApiErrorDetail {
  readonly path?: string;
  readonly code: string;
}

/** Thrown anywhere in the request pipeline; error-handler.ts is the only
 * place that turns this into an HTTP response, so every error path
 * produces the identical ApiErrorResponseV1 shape. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly details: readonly ApiErrorDetail[] | undefined;

  constructor(code: ApiErrorCode, message: string, details?: readonly ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = STATUS_BY_CODE[code];
    this.details = details;
  }
}
