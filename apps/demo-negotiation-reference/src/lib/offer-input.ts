// SPDX-License-Identifier: Apache-2.0
// Pure builder from a customer's raw offer form input to a full
// NegotiationInputV1 -- the synthetic, technical demo negotiation policy
// documented in docs/negotiation-policy-v1.md (see
// policies/negotiation-v1/src/lib.rs's own header: not real Negotiation Reference
// Sales pricing data). Fixed, hardcoded demo constants stand in for a
// real vehicle listing; only the customer's offer, running offer number,
// and condition-report acknowledgement come from the request.
//
// Deliberately only `import type`s from @ddn/schemas (fully erased at
// compile time) -- this file is also imported by src/app/page.tsx (a
// Client Component, for the price constants), and a real VALUE import of
// @ddn/schemas would pull its node:fs-based JSON schema loading into the
// browser bundle. The schema-*validating* builder
// (buildValidatedSubmitDecisionRequest) lives in offer-input-server.ts
// instead, imported only by route.ts.

import type { NegotiationInputV1, SubmitDecisionRequestV1 } from '@ddn/schemas';

export const DEMO_REFERENCE_VEHICLE_ID = 'vehicle-demo-001';
export const DEMO_REFERENCE_TENANT_ID = 'm7-demo-reference-tenant';
export const DEMO_REFERENCE_LIST_PRICE_CENTS = 3_000_000;
export const DEMO_REFERENCE_FLOOR_PRICE_CENTS = 2_700_000;
export const DEMO_REFERENCE_MAX_OFFERS = 3;

export const NEGOTIATION_POLICY_ID = 'negotiation-v1';
export const NEGOTIATION_POLICY_VERSION = '1.0.0';
export const NEGOTIATION_VERIFICATION_PROFILE_ID = 'ddn-wasm-v1';

export interface OfferFormInput {
  readonly sessionId: string;
  readonly customerOfferCents: number;
  readonly offerNumber: number;
  readonly conditionReportAcknowledged: boolean;
}

export type OfferInputErrorCode = 'INVALID_SESSION_ID' | 'INVALID_OFFER_CENTS' | 'INVALID_OFFER_NUMBER' | 'SCHEMA_VALIDATION_FAILED';

export class OfferInputError extends Error {
  readonly code: OfferInputErrorCode;
  constructor(code: OfferInputErrorCode, message: string) {
    super(message);
    this.name = 'OfferInputError';
    this.code = code;
  }
}

/** Validates the shape of what a browser can actually control (the
 * customer's own inputs) before ever building a NegotiationInputV1 --
 * everything else in the resulting object is a fixed demo constant, and
 * any OTHER field present in `body` (tenantId, policyVersion, an
 * internal id, a whole wire request, ...) is silently ignored, never
 * read. offerNumber is capped at DEMO_REFERENCE_MAX_OFFERS here too (not
 * just relying on the upstream schema's own cross-field check) so an
 * out-of-range offer is rejected before ever building a request. */
export function parseOfferFormInput(body: unknown): OfferFormInput {
  if (typeof body !== 'object' || body === null) {
    throw new OfferInputError('INVALID_SESSION_ID', 'request body must be a JSON object');
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj.sessionId !== 'string' || obj.sessionId.length === 0 || obj.sessionId.length > 128) {
    throw new OfferInputError('INVALID_SESSION_ID', 'sessionId must be a non-empty string');
  }
  if (typeof obj.customerOfferCents !== 'number' || !Number.isInteger(obj.customerOfferCents) || obj.customerOfferCents < 0) {
    throw new OfferInputError('INVALID_OFFER_CENTS', 'customerOfferCents must be a non-negative integer');
  }
  if (
    typeof obj.offerNumber !== 'number' ||
    !Number.isInteger(obj.offerNumber) ||
    obj.offerNumber < 1 ||
    obj.offerNumber > DEMO_REFERENCE_MAX_OFFERS
  ) {
    throw new OfferInputError('INVALID_OFFER_NUMBER', `offerNumber must be an integer between 1 and ${DEMO_REFERENCE_MAX_OFFERS}`);
  }
  return {
    sessionId: obj.sessionId,
    customerOfferCents: obj.customerOfferCents,
    offerNumber: obj.offerNumber,
    conditionReportAcknowledged: obj.conditionReportAcknowledged === true,
  };
}

export function buildNegotiationInput(input: OfferFormInput, now: () => string = () => new Date().toISOString()): NegotiationInputV1 {
  return {
    schemaVersion: '1.0.0',
    tenantId: DEMO_REFERENCE_TENANT_ID,
    vehicleId: DEMO_REFERENCE_VEHICLE_ID,
    sessionId: input.sessionId,
    listPriceCents: DEMO_REFERENCE_LIST_PRICE_CENTS,
    floorPriceCents: DEMO_REFERENCE_FLOOR_PRICE_CENTS,
    customerOfferCents: input.customerOfferCents,
    offerNumber: input.offerNumber,
    maxOffers: DEMO_REFERENCE_MAX_OFFERS,
    conditionReportAcknowledged: input.conditionReportAcknowledged,
    policyEffectiveAt: now(),
  };
}

/** Structurally builds the wire request -- the *validating* variant
 * (offer-input-server.ts's buildValidatedSubmitDecisionRequest) is what
 * route.ts actually calls; this one is kept for buildNegotiationInput's
 * own unit tests and does not itself run @ddn/schemas' validator. */
export function buildSubmitDecisionRequest(input: OfferFormInput): SubmitDecisionRequestV1 {
  return {
    schemaVersion: '1.0.0',
    policy: { policyId: NEGOTIATION_POLICY_ID, policyVersion: NEGOTIATION_POLICY_VERSION },
    input: buildNegotiationInput(input) as unknown as Record<string, unknown>,
    verificationProfileId: NEGOTIATION_VERIFICATION_PROFILE_ID,
  };
}
