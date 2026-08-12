// SPDX-License-Identifier: Apache-2.0
// DDN HTTP API v1 contract types -- shared between @ddn/api (server-side
// validation) and @ddn/client-sdk (response typing), so the two can never
// silently drift on request/response shape. Same source-of-truth convention
// as index.ts's negotiation types: JSON Schema (packages/schemas/json/api-v1/)
// is authoritative, ajv validates directly against it, these TypeScript
// interfaces are kept in sync by hand, and apps/api's OpenAPI generation
// reads the same schema files -- not a second parallel schema
// system. See docs/api-v1.md.

import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsPlugin from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ajv-formats ships a CJS default export that TS's NodeNext resolution
// mistypes as the whole module namespace (a known ajv-formats/TS interop
// issue, not a real ambiguity at runtime -- module.exports is the function).
const addFormats = addFormatsPlugin as unknown as (ajv: Ajv) => Ajv;

export type DecisionStatus = 'PENDING' | 'RUNNING' | 'FINALIZED' | 'NO_QUORUM' | 'FAILED';

export interface PolicyRefV1 {
  readonly policyId: string;
  readonly policyVersion: string;
}

export interface SubmitDecisionRequestV1 {
  readonly schemaVersion: string;
  readonly policy: PolicyRefV1;
  readonly input: Record<string, unknown>;
  readonly verificationProfileId: string;
}

export interface DecisionPendingOrRunningResponseV1 {
  readonly schemaVersion: string;
  readonly decisionId: string;
  readonly status: 'PENDING' | 'RUNNING';
  readonly submittedAt: string;
  readonly updatedAt: string;
}

export interface DecisionVerificationSummaryV1 {
  readonly receiptId: string;
  readonly validatorSetId: string;
  readonly matchingValidators: number;
  readonly requiredQuorum: number;
  readonly policyHash: string;
  readonly profileHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly executionHash: string;
}

export interface DecisionFinalizedResponseV1 {
  readonly schemaVersion: string;
  readonly decisionId: string;
  readonly status: 'FINALIZED';
  readonly result: Record<string, unknown>;
  readonly verification: DecisionVerificationSummaryV1;
  readonly submittedAt: string;
  readonly finalizedAt: string;
}

export interface DecisionErrorStatusResponseV1 {
  readonly schemaVersion: string;
  readonly decisionId: string;
  readonly status: 'NO_QUORUM' | 'FAILED';
  readonly error: { readonly code: string; readonly message: string };
  readonly submittedAt: string;
  readonly updatedAt: string;
}

/** Also the response body for POST /v1/decisions, not just GET
 * /v1/decisions/{decisionId} -- there is no separate "just accepted"
 * shape. A fresh submission returns the PENDING variant with HTTP 201; an
 * idempotent replay of a request whose decision has already moved past
 * PENDING returns whatever state it has actually reached, with HTTP 200,
 * rather than re-asserting a PENDING status that would no longer be true. */
export type DecisionStatusResponseV1 =
  | DecisionPendingOrRunningResponseV1
  | DecisionFinalizedResponseV1
  | DecisionErrorStatusResponseV1;

export type DecisionTerminalResponseV1 = DecisionFinalizedResponseV1 | DecisionErrorStatusResponseV1;

export interface VerifyReceiptRequestV1 {
  readonly schemaVersion: string;
  readonly receipt: unknown;
}

/** Mirrors @ddn/receipt-sdk's own ReceiptVerificationCheck shape exactly
 * (name/passed/detail) rather than re-deriving a fixed set of named
 * booleans -- the set of checks verifyDecisionReceipt runs is that
 * library's decision alone, and duplicating it here as separate fields
 * would just be a second, driftable copy of the same information. */
export interface ReceiptVerificationCheckV1 {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface VerifyReceiptResponseV1 {
  readonly schemaVersion: string;
  readonly status: 'VALID' | 'INVALID';
  readonly checks: readonly ReceiptVerificationCheckV1[];
  readonly receiptId?: string;
}

export interface PolicySummaryV1 {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly profileHash: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

export interface PolicyListResponseV1 {
  readonly schemaVersion: string;
  readonly policies: readonly PolicySummaryV1[];
}

export interface PolicyDetailResponseV1 {
  readonly schemaVersion: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly profileHash: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly reasonCodes: readonly string[];
}

export interface AnchorProofV1 {
  readonly leafHash: string;
  readonly leafIndex: number;
  readonly siblings: readonly string[];
  readonly totalLeaves: number;
}

export interface AnchorChainBindingV1 {
  readonly chainId: number;
  readonly contractAddress: string;
}

export interface AnchorConfirmationV1 {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly confirmedAt: string;
}

/** 200 response body for GET /v1/decisions/{decisionId}/anchor -- the wire
 * shape of @ddn/receipt-sdk's AnchorRecordV1, keyed by receiptId (what the
 * Merkle leaf actually commits to), not decisionId (the URL's own scoping).
 * Only returned once the anchor sidecar's internal state machine reaches
 * CONFIRMED. An existing, tenant-owned decision short of CONFIRMED responds
 * 409 ANCHOR_NOT_AVAILABLE; an unknown decisionId or one belonging to a
 * different tenant responds 404 DECISION_NOT_FOUND -- the two cases are
 * never distinguishable from each other, only from the CONFIRMED case. */
export interface GetAnchorResponseV1 {
  readonly schemaVersion: string;
  readonly receiptId: string;
  readonly batchId: string;
  readonly merkleRoot: string;
  readonly proof: AnchorProofV1;
  readonly chain: AnchorChainBindingV1;
  readonly confirmation: AnchorConfirmationV1;
}

export type ValidatorProgressPhaseV1 = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';

export interface ValidatorProgressEntryV1 {
  readonly validatorId: string;
  readonly phase: ValidatorProgressPhaseV1;
  readonly updatedAt: string;
  readonly outputHash?: string;
}

/** 200 response body for GET /v1/decisions/{decisionId}/validators
 * (Milestone 7) -- mirrors real per-validator subprocess lifecycle events;
 * see @ddn/coordinator's onValidatorProgress and docs/public-demo-boundary.md. An
 * empty `validators` array means the decision hasn't started running
 * validators yet (still PENDING), not an error. */
export interface ValidatorProgressResponseV1 {
  readonly schemaVersion: string;
  readonly decisionId: string;
  readonly validators: readonly ValidatorProgressEntryV1[];
}

export interface ApiErrorDetailV1 {
  readonly path?: string;
  readonly code: string;
}

export interface ApiErrorResponseV1 {
  readonly schemaVersion: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly details?: readonly ApiErrorDetailV1[];
  };
}

// --- Validation, backed by packages/schemas/json/api-v1/*.schema.json --
// the same files apps/api's OpenAPI generator reads, so the
// wire contract, the runtime check, and the published OpenAPI document
// can never quietly diverge. ---

export class ApiSchemaValidationError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiSchemaValidationError';
    this.code = code;
    this.details = details;
  }
}

// See index.ts's own readJsonSchema for why this uses the single-argument
// fileURLToPath(import.meta.url) plus plain node:path math, rather than
// any two-argument `new URL(..., import.meta.url)` form.
const API_JSON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'json', 'api-v1');

function readApiJsonSchema(filename: string): object {
  return JSON.parse(readFileSync(join(API_JSON_DIR, filename), 'utf8'));
}

const apiAjv = new Ajv({ allErrors: true, strict: true });
addFormats(apiAjv);

const submitDecisionRequestSchema = readApiJsonSchema('submit-decision-request.schema.json');
const verifyReceiptRequestSchema = readApiJsonSchema('verify-receipt-request.schema.json');
const decisionStatusResponseSchema = readApiJsonSchema('decision-status-response.schema.json');
const verifyReceiptResponseSchema = readApiJsonSchema('verify-receipt-response.schema.json');
const policyListResponseSchema = readApiJsonSchema('policy-list-response.schema.json');
const policyDetailResponseSchema = readApiJsonSchema('policy-detail-response.schema.json');
const getAnchorResponseSchema = readApiJsonSchema('get-anchor-response.schema.json');
const validatorProgressResponseSchema = readApiJsonSchema('validator-progress-response.schema.json');
const apiErrorResponseSchema = readApiJsonSchema('api-error-response.schema.json');

/** The raw JSON Schema documents backing every parse function below,
 * exported so apps/api's OpenAPI generator can embed the exact
 * same schemas its request/response validation actually runs against,
 * instead of re-reading the files itself via a relative path across
 * package boundaries or hand-copying the schemas into a second document. */
export const API_V1_JSON_SCHEMAS = {
  submitDecisionRequest: submitDecisionRequestSchema,
  verifyReceiptRequest: verifyReceiptRequestSchema,
  decisionStatusResponse: decisionStatusResponseSchema,
  verifyReceiptResponse: verifyReceiptResponseSchema,
  policyListResponse: policyListResponseSchema,
  policyDetailResponse: policyDetailResponseSchema,
  getAnchorResponse: getAnchorResponseSchema,
  validatorProgressResponse: validatorProgressResponseSchema,
  apiErrorResponse: apiErrorResponseSchema,
} as const;

// Some bundlers/runtimes (observed with Next.js/Turbopack's route
// "collect configuration" step -- apps/explorer's demo BFF routes) can
// end up re-evaluating this module's top-level code more than once
// within what ajv still considers the same schema registry, which would
// otherwise throw "schema with key or id ... already exists" on the
// second pass. An earlier version of this function reused whatever
// apiAjv.getSchema(id) returned in that case; that masked the crash but
// was observed (in apps/demo-negotiation-reference's offer route) to occasionally
// return a validator compiled for a COMPLETELY DIFFERENT schema sharing
// the same $id string -- silently validating against the wrong schema is
// far worse than a loud crash. compileOnce now strips $id before
// compiling, so this schema is never registered under an id in the first
// place: nothing can collide with it or be mistakenly reused across
// module realms, and it behaves exactly like a plain apiAjv.compile()
// otherwise.
function compileOnce(schema: { readonly $id?: string }): ValidateFunction {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $id, ...schemaWithoutId } = schema as Record<string, unknown>;
  return apiAjv.compile(schemaWithoutId);
}

const validateSubmitDecisionRequest: ValidateFunction = compileOnce(submitDecisionRequestSchema);
const validateVerifyReceiptRequest: ValidateFunction = compileOnce(verifyReceiptRequestSchema);
const validateDecisionStatusResponse: ValidateFunction = compileOnce(decisionStatusResponseSchema);
const validateVerifyReceiptResponse: ValidateFunction = compileOnce(verifyReceiptResponseSchema);
const validatePolicyListResponse: ValidateFunction = compileOnce(policyListResponseSchema);
const validatePolicyDetailResponse: ValidateFunction = compileOnce(policyDetailResponseSchema);
const validateGetAnchorResponse: ValidateFunction = compileOnce(getAnchorResponseSchema);
const validateValidatorProgressResponse: ValidateFunction = compileOnce(validatorProgressResponseSchema);
const validateApiErrorResponse: ValidateFunction = compileOnce(apiErrorResponseSchema);

const MAX_INPUT_SERIALIZED_BYTES = 20_000;

/** Structural check only -- `input` is deliberately not validated against
 * negotiation-input-v1.schema.json here, since tenantId may be absent (the
 * API injects the authenticated tenantId before that stricter check runs,
 * downstream in the decision service). See submit-decision-request.schema.json. */
export function parseSubmitDecisionRequestV1(value: unknown): SubmitDecisionRequestV1 {
  if (!validateSubmitDecisionRequest(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to submit-decision-request.schema.json',
      validateSubmitDecisionRequest.errors
    );
  }
  const request = value as SubmitDecisionRequestV1;
  if (JSON.stringify(request.input).length > MAX_INPUT_SERIALIZED_BYTES) {
    throw new ApiSchemaValidationError('REQUEST_TOO_LARGE', 'SubmitDecisionRequestV1.input exceeds the size limit');
  }
  return request;
}

export function parseVerifyReceiptRequestV1(value: unknown): VerifyReceiptRequestV1 {
  if (!validateVerifyReceiptRequest(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to verify-receipt-request.schema.json',
      validateVerifyReceiptRequest.errors
    );
  }
  return value as VerifyReceiptRequestV1;
}

/** Defensive response parsing for @ddn/client-sdk: an external client must
 * not blindly trust that the server sent well-formed JSON matching this
 * contract. Used for both POST /v1/decisions and GET
 * /v1/decisions/{decisionId} responses -- see DecisionStatusResponseV1. */
export function parseDecisionStatusResponseV1(value: unknown): DecisionStatusResponseV1 {
  if (!validateDecisionStatusResponse(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to decision-status-response.schema.json',
      validateDecisionStatusResponse.errors
    );
  }
  return value as DecisionStatusResponseV1;
}

export function parseVerifyReceiptResponseV1(value: unknown): VerifyReceiptResponseV1 {
  if (!validateVerifyReceiptResponse(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to verify-receipt-response.schema.json',
      validateVerifyReceiptResponse.errors
    );
  }
  return value as VerifyReceiptResponseV1;
}

export function parsePolicyListResponseV1(value: unknown): PolicyListResponseV1 {
  if (!validatePolicyListResponse(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to policy-list-response.schema.json',
      validatePolicyListResponse.errors
    );
  }
  return value as PolicyListResponseV1;
}

export function parsePolicyDetailResponseV1(value: unknown): PolicyDetailResponseV1 {
  if (!validatePolicyDetailResponse(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to policy-detail-response.schema.json',
      validatePolicyDetailResponse.errors
    );
  }
  return value as PolicyDetailResponseV1;
}

export function parseGetAnchorResponseV1(value: unknown): GetAnchorResponseV1 {
  if (!validateGetAnchorResponse(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to get-anchor-response.schema.json',
      validateGetAnchorResponse.errors
    );
  }
  return value as GetAnchorResponseV1;
}

export function parseValidatorProgressResponseV1(value: unknown): ValidatorProgressResponseV1 {
  if (!validateValidatorProgressResponse(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to validator-progress-response.schema.json',
      validateValidatorProgressResponse.errors
    );
  }
  return value as ValidatorProgressResponseV1;
}

export function parseApiErrorResponseV1(value: unknown): ApiErrorResponseV1 {
  if (!validateApiErrorResponse(value)) {
    throw new ApiSchemaValidationError(
      'INVALID_REQUEST',
      'value does not conform to api-error-response.schema.json',
      validateApiErrorResponse.errors
    );
  }
  return value as ApiErrorResponseV1;
}
