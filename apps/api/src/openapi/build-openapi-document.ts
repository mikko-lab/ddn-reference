// SPDX-License-Identifier: Apache-2.0
// Assembles the OpenAPI 3.0 document for DDN API v1 straight from the
// same JSON Schema files packages/schemas/src/api-v1.ts validates
// against (API_V1_JSON_SCHEMAS) -- there is no second, hand-copied
// description of the wire contract to drift from the real one. This
// function only builds the in-memory object; generate-openapi.ts decides
// whether to write it, check it, or do neither.

import { API_V1_JSON_SCHEMAS } from '@ddn/schemas';

const OPENAPI_VERSION = '3.0.3';
const API_TITLE = 'DDN API v1';
const API_VERSION = '1.0.0';

/** Strips JSON-Schema-only meta keywords ($schema, $id) that are not part
 * of an OpenAPI Schema Object, keeping everything else (including title/
 * description) unchanged. */
function toOpenApiSchema(jsonSchema: object): Record<string, unknown> {
  const rest = { ...(jsonSchema as Record<string, unknown>) };
  delete rest.$schema;
  delete rest.$id;
  return rest;
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseV1' } } },
  };
}

const BEARER_AUTH_SECURITY = [{ bearerAuth: [] }];

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description:
        'Versioned HTTP API for submitting DDN decisions, polling their status, fetching DecisionReceiptV1 for offline verification, and listing/inspecting registered policies. See docs/api-v1.md.',
    },
    paths: {
      '/v1/decisions': {
        post: {
          operationId: 'submitDecision',
          summary: 'Submit a decision for asynchronous quorum execution.',
          security: BEARER_AUTH_SECURITY,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitDecisionRequestV1' } } },
          },
          responses: {
            '201': {
              description: 'A new decision was created and is PENDING.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/DecisionStatusResponseV1' } } },
            },
            '200': {
              description: 'An identical request was already submitted; the existing decision (in whatever state it has reached) is returned.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/DecisionStatusResponseV1' } } },
            },
            '400': errorResponse('The request failed schema validation, or named an unknown verification profile.'),
            '401': errorResponse('Missing or invalid service token.'),
            '403': errorResponse('The token lacks the decision:submit role, or input.tenantId conflicts with the authenticated tenant.'),
            '404': errorResponse('The referenced policy is not registered.'),
            '409': errorResponse('The referenced policy is registered but not ACTIVE.'),
            '413': errorResponse('The request body, or input specifically, exceeds the configured size limit.'),
          },
        },
      },
      '/v1/decisions/{decisionId}': {
        get: {
          operationId: 'getDecision',
          summary: 'Fetch the current status of a previously submitted decision.',
          security: BEARER_AUTH_SECURITY,
          parameters: [{ name: 'decisionId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The decision, in whatever state it has reached.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/DecisionStatusResponseV1' } } },
            },
            '401': errorResponse('Missing or invalid service token.'),
            '404': errorResponse('No decision with this id exists for the authenticated tenant.'),
          },
        },
      },
      '/v1/decisions/{decisionId}/receipt': {
        get: {
          operationId: 'getDecisionReceipt',
          summary: 'Fetch the raw DecisionReceiptV1 for a FINALIZED decision, for offline verification with @ddn/receipt-sdk.',
          security: BEARER_AUTH_SECURITY,
          parameters: [{ name: 'decisionId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The raw DecisionReceiptV1 (see @ddn/receipt-sdk) -- never trust this alone; verify it locally.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '401': errorResponse('Missing or invalid service token.'),
            '404': errorResponse('No decision with this id exists for the authenticated tenant.'),
            '409': errorResponse('The decision has not reached FINALIZED, so no receipt exists yet.'),
          },
        },
      },
      '/v1/decisions/{decisionId}/anchor': {
        get: {
          operationId: 'getDecisionAnchor',
          summary:
            'Fetch the AnchorRecordV1 proving a FINALIZED decision\'s receipt was anchored on-chain, for offline verification with @ddn/receipt-sdk\'s verifyAnchoredDecisionReceipt.',
          security: BEARER_AUTH_SECURITY,
          parameters: [{ name: 'decisionId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The AnchorRecordV1 -- never trust this alone; verify it locally against a trusted chain reader.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/GetAnchorResponseV1' } } },
            },
            '401': errorResponse('Missing or invalid service token.'),
            '404': errorResponse('No decision with this id exists for the authenticated tenant.'),
            '409': errorResponse('The decision has not yet been anchored on-chain (anchoring is decoupled from FINALIZED, and is optional infrastructure -- see ADR-001).'),
          },
        },
      },
      '/v1/decisions/{decisionId}/validators': {
        get: {
          operationId: 'getDecisionValidatorProgress',
          summary:
            'Fetch real per-validator subprocess progress for a decision (Milestone 7) -- for a live status view, never a substitute for the receipt itself.',
          security: BEARER_AUTH_SECURITY,
          parameters: [{ name: 'decisionId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description:
                'Per-validator phase/timestamp/outputHash. An empty validators array means the decision has not started running validators yet.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidatorProgressResponseV1' } } },
            },
            '401': errorResponse('Missing or invalid service token.'),
            '404': errorResponse('No decision with this id exists for the authenticated tenant.'),
          },
        },
      },
      '/v1/receipts/verify': {
        post: {
          operationId: 'verifyReceipt',
          summary: 'Server-side convenience re-check of a DecisionReceiptV1 -- never a substitute for local verification.',
          security: BEARER_AUTH_SECURITY,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VerifyReceiptRequestV1' } } },
          },
          responses: {
            '200': {
              description: 'The verification result, whether or not the receipt was valid.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/VerifyReceiptResponseV1' } } },
            },
            '400': errorResponse('The request failed schema validation.'),
            '401': errorResponse('Missing or invalid service token.'),
          },
        },
      },
      '/v1/policies': {
        get: {
          operationId: 'listPolicies',
          summary: 'List every registered policy and its current hashes/status.',
          security: BEARER_AUTH_SECURITY,
          responses: {
            '200': {
              description: 'The registered policies.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyListResponseV1' } } },
            },
            '401': errorResponse('Missing or invalid service token.'),
          },
        },
      },
      '/v1/policies/{policyId}/{policyVersion}': {
        get: {
          operationId: 'getPolicy',
          summary: 'Fetch one registered policy, including its input/output JSON Schemas and closed reason-code list.',
          security: BEARER_AUTH_SECURITY,
          parameters: [
            { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'policyVersion', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'The policy detail.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyDetailResponseV1' } } },
            },
            '401': errorResponse('Missing or invalid service token.'),
            '404': errorResponse('No policy registered for this (policyId, policyVersion) pair.'),
          },
        },
      },
      '/healthz': {
        get: {
          operationId: 'getHealth',
          summary: 'Liveness check. No auth required.',
          responses: {
            '200': {
              description: 'The service is up.',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { const: 'ok' } } } } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        SubmitDecisionRequestV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.submitDecisionRequest),
        DecisionStatusResponseV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.decisionStatusResponse),
        VerifyReceiptRequestV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.verifyReceiptRequest),
        VerifyReceiptResponseV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.verifyReceiptResponse),
        PolicyListResponseV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.policyListResponse),
        PolicyDetailResponseV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.policyDetailResponse),
        GetAnchorResponseV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.getAnchorResponse),
        ValidatorProgressResponseV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.validatorProgressResponse),
        ApiErrorResponseV1: toOpenApiSchema(API_V1_JSON_SCHEMAS.apiErrorResponse),
      },
    },
  };
}
