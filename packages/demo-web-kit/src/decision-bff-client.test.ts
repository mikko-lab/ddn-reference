// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionBffClient } from './decision-bff-client.js';

test('401 handling is caller-injected and contains no hard-coded navigation', async () => {
  const originalFetch = globalThis.fetch;
  let unauthorizedCalls = 0;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });

  try {
    const client = createDecisionBffClient('/api/reference/decisions', {
      onUnauthorized: () => {
        unauthorizedCalls += 1;
      },
    });
    await assert.rejects(client.fetchDecisionStatus('decision-1'), /authentication required/);
    assert.equal(unauthorizedCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
