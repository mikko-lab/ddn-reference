// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryStorage, getNextOfferNumber, getOrCreateSessionId, recordOfferSubmitted, resetSession } from './offer-session';

test('getOrCreateSessionId creates and persists a new id on first use', () => {
  const storage = createInMemoryStorage();
  const id = getOrCreateSessionId(storage, () => 'fixed-id');
  assert.equal(id, 'fixed-id');
  assert.equal(storage.getItem('ddn-reference-session-id'), 'fixed-id');
});

test('getOrCreateSessionId returns the same id on subsequent calls', () => {
  const storage = createInMemoryStorage();
  const first = getOrCreateSessionId(storage, () => 'first-id');
  const second = getOrCreateSessionId(storage, () => 'second-id');
  assert.equal(first, 'first-id');
  assert.equal(second, 'first-id');
});

test('getNextOfferNumber defaults to 1 for a brand new session', () => {
  const storage = createInMemoryStorage();
  assert.equal(getNextOfferNumber(storage), 1);
});

test('recordOfferSubmitted advances the next offer number', () => {
  const storage = createInMemoryStorage();
  assert.equal(getNextOfferNumber(storage), 1);
  recordOfferSubmitted(storage, 1);
  assert.equal(getNextOfferNumber(storage), 2);
  recordOfferSubmitted(storage, 2);
  assert.equal(getNextOfferNumber(storage), 3);
});

test('resetSession starts a fresh sessionId and resets the offer number to 1', () => {
  const storage = createInMemoryStorage();
  getOrCreateSessionId(storage, () => 'old-id');
  recordOfferSubmitted(storage, 1);
  assert.equal(getNextOfferNumber(storage), 2);

  const newId = resetSession(storage, () => 'new-id');
  assert.equal(newId, 'new-id');
  assert.equal(getOrCreateSessionId(storage, () => 'should-not-be-used'), 'new-id');
  assert.equal(getNextOfferNumber(storage), 1);
});
