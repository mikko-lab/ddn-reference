// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNegotiationInputV1,
  validateNegotiationOutputV1,
  SchemaValidationError,
  NEGOTIATION_REASON_CODES_V1,
} from './index.js';

function throwsWithCode(fn: () => void, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof SchemaValidationError, 'expected SchemaValidationError');
    assert.equal(err.code, code);
    return true;
  });
}

const validInput = {
  schemaVersion: '1.0.0' as const,
  tenantId: 'tenant-synthetic-01',
  vehicleId: 'vehicle-synthetic-01',
  sessionId: 'session-synthetic-01',
  listPriceCents: 2_500_000,
  floorPriceCents: 2_300_000,
  customerOfferCents: 2_200_000,
  offerNumber: 1,
  maxOffers: 4,
  conditionReportAcknowledged: true,
  policyEffectiveAt: '2026-01-01T00:00:00Z',
};

test('valid negotiation input passes', () => {
  assert.doesNotThrow(() => validateNegotiationInputV1({ ...validInput }));
});

test('unknown fields are rejected', () => {
  assert.throws(
    () => validateNegotiationInputV1({ ...validInput, unknownField: 'x' }),
    SchemaValidationError
  );
});

test('floorPriceCents > listPriceCents is rejected', () => {
  throwsWithCode(() => {
    validateNegotiationInputV1({ ...validInput, floorPriceCents: validInput.listPriceCents + 1 });
  }, 'INVALID_PRICE_RELATION');
});

test('offerNumber > maxOffers is rejected', () => {
  throwsWithCode(() => {
    validateNegotiationInputV1({ ...validInput, offerNumber: 5, maxOffers: 4 });
  }, 'INVALID_OFFER_RELATION');
});

test('empty tenantId is rejected', () => {
  assert.throws(() => validateNegotiationInputV1({ ...validInput, tenantId: '' }));
});

test('non-UTC policyEffectiveAt is rejected', () => {
  assert.throws(() => validateNegotiationInputV1({ ...validInput, policyEffectiveAt: '2026-01-01T00:00:00+02:00' }));
});

const validOutput = {
  schemaVersion: '1.0.0' as const,
  decision: 'COUNTER' as const,
  counterOfferCents: 2_300_000,
  reasonCodes: ['OFFER_BELOW_FLOOR', 'FINAL_COUNTER_AVAILABLE'] as const,
  humanReviewRequired: false,
};

test('valid negotiation output passes', () => {
  assert.doesNotThrow(() => validateNegotiationOutputV1({ ...validOutput }));
});

test('ACCEPT with non-null counterOfferCents is rejected', () => {
  throwsWithCode(() => {
    validateNegotiationOutputV1({
      schemaVersion: '1.0.0',
      decision: 'ACCEPT',
      counterOfferCents: 100,
      reasonCodes: ['OFFER_AT_OR_ABOVE_LIST'],
      humanReviewRequired: false,
    });
  }, 'INVALID_COUNTER_OFFER');
});

test('ESCALATE without humanReviewRequired is rejected', () => {
  throwsWithCode(() => {
    validateNegotiationOutputV1({
      schemaVersion: '1.0.0',
      decision: 'ESCALATE',
      counterOfferCents: null,
      reasonCodes: ['INVALID_PRICE_RELATION'],
      humanReviewRequired: false,
    });
  }, 'INVALID_HUMAN_REVIEW_FLAG');
});

test('duplicate reason codes are rejected', () => {
  throwsWithCode(() => {
    validateNegotiationOutputV1({
      ...validOutput,
      reasonCodes: ['OFFER_BELOW_FLOOR', 'OFFER_BELOW_FLOOR'],
    });
  }, 'DUPLICATE_REASON_CODE');
});

test('unknown reason code is rejected by schema', () => {
  assert.throws(() => {
    validateNegotiationOutputV1({
      ...validOutput,
      reasonCodes: ['NOT_A_REAL_CODE'],
    });
  });
});

test('reason code registry has exactly the 9 documented codes', () => {
  assert.equal(NEGOTIATION_REASON_CODES_V1.length, 9);
});
