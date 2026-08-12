// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rate-limiter.js';

test('createRateLimiter allows requests under the limit', () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxRequestsPerWindow: 3 });
  assert.equal(limiter.check('a', 0), true);
  assert.equal(limiter.check('a', 1), true);
  assert.equal(limiter.check('a', 2), true);
});

test('createRateLimiter rejects once the limit is hit within the window', () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxRequestsPerWindow: 2 });
  assert.equal(limiter.check('a', 0), true);
  assert.equal(limiter.check('a', 1), true);
  assert.equal(limiter.check('a', 2), false);
});

test('createRateLimiter allows again once old requests fall outside the window', () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxRequestsPerWindow: 1 });
  assert.equal(limiter.check('a', 0), true);
  assert.equal(limiter.check('a', 500), false);
  assert.equal(limiter.check('a', 1500), true);
});

test('createRateLimiter tracks separate keys independently', () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxRequestsPerWindow: 1 });
  assert.equal(limiter.check('a', 0), true);
  assert.equal(limiter.check('b', 0), true);
  assert.equal(limiter.check('a', 1), false);
  assert.equal(limiter.check('b', 1), false);
});
