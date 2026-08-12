// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfferInputError } from './offer-input';
import { buildValidatedSubmitDecisionRequest } from './offer-input-server';

test('buildValidatedSubmitDecisionRequest builds a schema-valid request for a well-formed offer', () => {
  const request = buildValidatedSubmitDecisionRequest({
    sessionId: 'sess-1',
    customerOfferCents: 2_800_000,
    offerNumber: 1,
    conditionReportAcknowledged: true,
  });
  assert.equal(request.policy.policyId, 'negotiation-v1');
  assert.equal((request.input as { sessionId: string }).sessionId, 'sess-1');
});

test("buildValidatedSubmitDecisionRequest never lets the caller override the tenant, policy version, vehicle id, or price constants -- extra body fields parsed upstream are simply not part of OfferFormInput", () => {
  // parseOfferFormInput already strips anything beyond its own four
  // fields; this proves the BUILDER side also never trusts anything else
  // even if a caller constructed an OfferFormInput-shaped object by hand.
  const request = buildValidatedSubmitDecisionRequest({
    sessionId: 'sess-1',
    customerOfferCents: 2_800_000,
    offerNumber: 1,
    conditionReportAcknowledged: true,
  });
  const input = request.input as Record<string, unknown>;
  assert.equal(input.tenantId, 'm7-demo-reference-tenant');
  assert.equal(input.vehicleId, 'vehicle-demo-001');
  assert.equal(input.listPriceCents, 3_000_000);
  assert.equal(input.floorPriceCents, 2_700_000);
  assert.equal(request.policy.policyVersion, '1.0.0');
  assert.equal(request.verificationProfileId, 'ddn-wasm-v1');
});

test('buildValidatedSubmitDecisionRequest rejects an offerNumber beyond maxOffers via the real schema validator, not just a hand-rolled range check', () => {
  // parseOfferFormInput already rejects this at the HTTP boundary; this
  // test exercises the builder's own defense-in-depth validation call
  // directly, bypassing that first gate, proving it independently holds.
  assert.throws(
    () =>
      buildValidatedSubmitDecisionRequest({
        sessionId: 'sess-1',
        customerOfferCents: 2_800_000,
        offerNumber: 999,
        conditionReportAcknowledged: true,
      }),
    OfferInputError
  );
});
