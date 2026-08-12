// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeVerificationOutcome, type VerificationOutcome } from './verification-outcome.js';

const OUTCOMES: readonly VerificationOutcome[] = ['VALID', 'INVALID', 'INCOMPLETE'];

test('describeVerificationOutcome returns a distinct glyph and tone for all three outcomes', () => {
  const descriptions = OUTCOMES.map(describeVerificationOutcome);
  assert.equal(new Set(descriptions.map((d) => d.glyph)).size, 3);
  assert.equal(new Set(descriptions.map((d) => d.tone)).size, 3);
});

test('describeVerificationOutcome never labels INCOMPLETE the same tone as INVALID', () => {
  assert.notEqual(describeVerificationOutcome('INCOMPLETE').tone, describeVerificationOutcome('INVALID').tone);
});

test('describeVerificationOutcome VALID uses the success tone', () => {
  assert.equal(describeVerificationOutcome('VALID').tone, 'success');
});
