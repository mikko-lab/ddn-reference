// SPDX-License-Identifier: Apache-2.0
// Pure helpers for tracking one browser tab's negotiation session
// (a fixed sessionId + the next offer number to submit) across multiple
// rounds of the demo -- operates on any Storage-shaped object (real
// sessionStorage in the browser, a plain in-memory Map-backed fake in
// tests) so the actual state-transition logic is directly testable.

const SESSION_ID_KEY = 'ddn-reference-session-id';
const OFFER_NUMBER_KEY = 'ddn-reference-offer-number';

export interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createInMemoryStorage(): SimpleStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function generateSessionId(): string {
  return `sess-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Returns the current session's sessionId, creating and persisting a new
 * one if none exists yet. */
export function getOrCreateSessionId(storage: SimpleStorage, idFactory: () => string = generateSessionId): string {
  const existing = storage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const created = idFactory();
  storage.setItem(SESSION_ID_KEY, created);
  return created;
}

/** The offer number to submit next -- 1 for a brand new session. */
export function getNextOfferNumber(storage: SimpleStorage): number {
  const raw = storage.getItem(OFFER_NUMBER_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Records that `offerNumber` was just submitted, so the next call to
 * getNextOfferNumber returns offerNumber + 1. */
export function recordOfferSubmitted(storage: SimpleStorage, offerNumber: number): void {
  storage.setItem(OFFER_NUMBER_KEY, String(offerNumber + 1));
}

/** Starts a brand new negotiation session (new sessionId, offer number
 * reset to 1) -- used when the customer wants to start over rather than
 * continue countering. */
export function resetSession(storage: SimpleStorage, idFactory: () => string = generateSessionId): string {
  const created = idFactory();
  storage.setItem(SESSION_ID_KEY, created);
  storage.setItem(OFFER_NUMBER_KEY, '1');
  return created;
}
