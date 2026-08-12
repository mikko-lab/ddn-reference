// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasJsonContentType, isAllowedOrigin, isBodyWithinLimit, isDeclaredSizeWithinLimit } from './request-guards';

test('hasJsonContentType accepts exactly application/json, with or without a charset parameter', () => {
  assert.equal(hasJsonContentType('application/json'), true);
  assert.equal(hasJsonContentType('application/json; charset=utf-8'), true);
});

test('hasJsonContentType rejects other content types and a missing header', () => {
  assert.equal(hasJsonContentType('text/plain'), false);
  assert.equal(hasJsonContentType('multipart/form-data; boundary=x'), false);
  assert.equal(hasJsonContentType('application/json-patch+json'), false);
  assert.equal(hasJsonContentType(null), false);
});

test('isDeclaredSizeWithinLimit accepts a Content-Length at or under the cap', () => {
  assert.equal(isDeclaredSizeWithinLimit('100', 4096), true);
  assert.equal(isDeclaredSizeWithinLimit('4096', 4096), true);
});

test('isDeclaredSizeWithinLimit rejects a Content-Length over the cap, missing, or unparsable', () => {
  assert.equal(isDeclaredSizeWithinLimit('4097', 4096), false);
  assert.equal(isDeclaredSizeWithinLimit(null, 4096), false);
  assert.equal(isDeclaredSizeWithinLimit('not-a-number', 4096), false);
  assert.equal(isDeclaredSizeWithinLimit('-1', 4096), false);
});

test('isBodyWithinLimit measures actual UTF-8 byte length, not just string length', () => {
  assert.equal(isBodyWithinLimit('a'.repeat(10), 10), true);
  assert.equal(isBodyWithinLimit('a'.repeat(11), 10), false);
  // multi-byte characters take more than one UTF-16 code unit's worth of bytes
  assert.equal(isBodyWithinLimit('€'.repeat(4), 10), false);
});

test('isAllowedOrigin allows a matching origin and disallows a mismatched one', () => {
  assert.equal(isAllowedOrigin('https://demo.example', 'https://demo.example'), true);
  assert.equal(isAllowedOrigin('https://attacker.example', 'https://demo.example'), false);
});

test('isAllowedOrigin allows a request with no Origin header at all (non-browser clients)', () => {
  assert.equal(isAllowedOrigin(null, 'https://demo.example'), true);
});
