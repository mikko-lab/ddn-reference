// SPDX-License-Identifier: Apache-2.0
// The schema-*validating* variant of buildSubmitDecisionRequest -- runs
// @ddn/schemas' own validateNegotiationInputV1 (the exact same runtime
// check apps/api itself applies to every submitted decision) over the
// constructed input before ever wrapping it into a SubmitDecisionRequestV1,
// so the server never sends a request built from anything but a
// validated NegotiationInputV1. Deliberately NOT imported by
// offer-input.ts (which src/app/page.tsx, a Client Component, also
// imports for its price constants) -- @ddn/schemas is a real, node:fs-
// touching value import here, and only route.ts (a Route Handler, never
// bundled for the browser) may import this file.

import { SchemaValidationError, validateNegotiationInputV1 } from '@ddn/schemas';
import type { SubmitDecisionRequestV1 } from '@ddn/schemas';
import {
  buildNegotiationInput,
  NEGOTIATION_POLICY_ID,
  NEGOTIATION_POLICY_VERSION,
  NEGOTIATION_VERIFICATION_PROFILE_ID,
  OfferInputError,
  type OfferFormInput,
} from './offer-input';

export function buildValidatedSubmitDecisionRequest(input: OfferFormInput): SubmitDecisionRequestV1 {
  const negotiationInput = buildNegotiationInput(input);
  try {
    validateNegotiationInputV1(negotiationInput);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw new OfferInputError('SCHEMA_VALIDATION_FAILED', 'the constructed request did not pass schema validation');
    }
    throw error;
  }
  return {
    schemaVersion: '1.0.0',
    policy: { policyId: NEGOTIATION_POLICY_ID, policyVersion: NEGOTIATION_POLICY_VERSION },
    input: negotiationInput as unknown as Record<string, unknown>,
    verificationProfileId: NEGOTIATION_VERIFICATION_PROFILE_ID,
  };
}
