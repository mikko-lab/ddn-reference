// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNegotiationInput,
  buildSubmitDecisionRequest,
  DEMO_REFERENCE_FLOOR_PRICE_CENTS,
  DEMO_REFERENCE_LIST_PRICE_CENTS,
  DEMO_REFERENCE_MAX_OFFERS,
  DEMO_REFERENCE_TENANT_ID,
  DEMO_REFERENCE_VEHICLE_ID,
  NEGOTIATION_POLICY_ID,
  NEGOTIATION_POLICY_VERSION,
  NEGOTIATION_VERIFICATION_PROFILE_ID,
  OfferInputError,
  parseOfferFormInput,
} from './offer-input';

test('parseOfferFormInput accepts a well-formed offer', () => {
  const parsed = parseOfferFormInput({ sessionId: 'sess-1', customerOfferCents: 2_800_000, offerNumber: 1, conditionReportAcknowledged: true });
  assert.deepEqual(parsed, { sessionId: 'sess-1', customerOfferCents: 2_800_000, offerNumber: 1, conditionReportAcknowledged: true });
});

test('parseOfferFormInput treats a missing conditionReportAcknowledged as false, never throwing', () => {
  const parsed = parseOfferFormInput({ sessionId: 'sess-1', customerOfferCents: 2_800_000, offerNumber: 1 });
  assert.equal(parsed.conditionReportAcknowledged, false);
});

test('parseOfferFormInput rejects a missing/empty sessionId', () => {
  assert.throws(() => parseOfferFormInput({ sessionId: '', customerOfferCents: 1, offerNumber: 1 }), OfferInputError);
  assert.throws(() => parseOfferFormInput({ customerOfferCents: 1, offerNumber: 1 }), OfferInputError);
});

test('parseOfferFormInput rejects a non-integer or negative customerOfferCents', () => {
  assert.throws(() => parseOfferFormInput({ sessionId: 's', customerOfferCents: -1, offerNumber: 1 }), OfferInputError);
  assert.throws(() => parseOfferFormInput({ sessionId: 's', customerOfferCents: 1.5, offerNumber: 1 }), OfferInputError);
  assert.throws(() => parseOfferFormInput({ sessionId: 's', customerOfferCents: 'a lot', offerNumber: 1 }), OfferInputError);
});

test('parseOfferFormInput rejects a non-positive offerNumber', () => {
  assert.throws(() => parseOfferFormInput({ sessionId: 's', customerOfferCents: 1, offerNumber: 0 }), OfferInputError);
  assert.throws(() => parseOfferFormInput({ sessionId: 's', customerOfferCents: 1, offerNumber: -1 }), OfferInputError);
});

test('parseOfferFormInput rejects an offerNumber beyond DEMO_REFERENCE_MAX_OFFERS', () => {
  assert.throws(
    () => parseOfferFormInput({ sessionId: 's', customerOfferCents: 1, offerNumber: DEMO_REFERENCE_MAX_OFFERS + 1 }),
    OfferInputError
  );
  assert.throws(() => parseOfferFormInput({ sessionId: 's', customerOfferCents: 1, offerNumber: 999 }), OfferInputError);
  // the boundary itself is still accepted
  assert.doesNotThrow(() => parseOfferFormInput({ sessionId: 's', customerOfferCents: 1, offerNumber: DEMO_REFERENCE_MAX_OFFERS }));
});

test('parseOfferFormInput ignores any field beyond its own four -- a caller cannot smuggle a tenantId, policyId/policyVersion, an internal id, or a whole wire request through the offer body', () => {
  const parsed = parseOfferFormInput({
    sessionId: 'sess-1',
    customerOfferCents: 2_800_000,
    offerNumber: 1,
    conditionReportAcknowledged: true,
    tenantId: 'attacker-tenant',
    vehicleId: 'attacker-vehicle',
    policyId: 'attacker-policy',
    policyVersion: '9.9.9',
    verificationProfileId: 'attacker-profile',
    listPriceCents: 1,
    floorPriceCents: 1,
    decisionId: 'dec_attacker',
    input: { anything: 'here' },
  });
  assert.deepEqual(parsed, { sessionId: 'sess-1', customerOfferCents: 2_800_000, offerNumber: 1, conditionReportAcknowledged: true });
});

test('parseOfferFormInput rejects a non-object body', () => {
  assert.throws(() => parseOfferFormInput('not an object'), OfferInputError);
  assert.throws(() => parseOfferFormInput(null), OfferInputError);
});

test('buildNegotiationInput fills in the fixed demo constants and passes the customer fields through untouched', () => {
  const fixedNow = () => '2026-01-01T00:00:00.000Z';
  const input = buildNegotiationInput({ sessionId: 'sess-1', customerOfferCents: 2_800_000, offerNumber: 2, conditionReportAcknowledged: true }, fixedNow);
  assert.deepEqual(input, {
    schemaVersion: '1.0.0',
    tenantId: DEMO_REFERENCE_TENANT_ID,
    vehicleId: DEMO_REFERENCE_VEHICLE_ID,
    sessionId: 'sess-1',
    listPriceCents: DEMO_REFERENCE_LIST_PRICE_CENTS,
    floorPriceCents: DEMO_REFERENCE_FLOOR_PRICE_CENTS,
    customerOfferCents: 2_800_000,
    offerNumber: 2,
    maxOffers: DEMO_REFERENCE_MAX_OFFERS,
    conditionReportAcknowledged: true,
    policyEffectiveAt: '2026-01-01T00:00:00.000Z',
  });
});

test('buildSubmitDecisionRequest wraps the negotiation input with the fixed policy/verification profile', () => {
  const request = buildSubmitDecisionRequest({ sessionId: 'sess-1', customerOfferCents: 2_800_000, offerNumber: 1, conditionReportAcknowledged: true });
  assert.equal(request.schemaVersion, '1.0.0');
  assert.deepEqual(request.policy, { policyId: NEGOTIATION_POLICY_ID, policyVersion: NEGOTIATION_POLICY_VERSION });
  assert.equal(request.verificationProfileId, NEGOTIATION_VERIFICATION_PROFILE_ID);
  assert.equal((request.input as { sessionId: string }).sessionId, 'sess-1');
});
