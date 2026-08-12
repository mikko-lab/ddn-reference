// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDecisionId } from './decision-id.js';

test('isValidDecisionId accepts a well-formed decisionId', () => {
  assert.equal(isValidDecisionId('dec_11111111-2222-3333-4444-555555555555'), true);
});

test('isValidDecisionId rejects a missing prefix', () => {
  assert.equal(isValidDecisionId('11111111-2222-3333-4444-555555555555'), false);
});

test('isValidDecisionId rejects a malformed uuid segment', () => {
  assert.equal(isValidDecisionId('dec_not-a-uuid'), false);
});

test('isValidDecisionId rejects path-traversal-shaped input', () => {
  assert.equal(isValidDecisionId('dec_../../../etc/passwd'), false);
});

test('isValidDecisionId rejects an empty string', () => {
  assert.equal(isValidDecisionId(''), false);
});

test('isValidDecisionId rejects uppercase hex', () => {
  assert.equal(isValidDecisionId('dec_11111111-2222-3333-4444-5555555555AA'), false);
});
