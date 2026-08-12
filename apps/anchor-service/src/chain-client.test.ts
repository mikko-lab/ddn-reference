// SPDX-License-Identifier: Apache-2.0
// Fast, no-Anvil-needed unit test for AnchorChainClient's constructor-time
// key validation -- this happens before any RPC call, so it doesn't need a
// live chain. See chain-client.integration.test.ts for everything that does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Hex } from 'viem';
import { AnchorChainClient, AnchorKeyConfigurationError } from './chain-client.js';

const VALID_CONTRACT_ADDRESS: Hex = `0x${'0'.repeat(40)}`;

test('a syntactically 32-byte but out-of-range secp256k1 key is rejected as AnchorKeyConfigurationError, never leaking the key', () => {
  // All-0xff is a valid 0x-prefixed 32-byte hex string (passes any purely
  // shape-based check) but is numerically >= the secp256k1 curve order,
  // so it is not a valid private key -- viem's privateKeyToAccount itself
  // rejects it, embedding a decimal re-encoding of the value in its own
  // error message (confirmed independently: `expected valid private key:
  // 1 <= n < ..., got <decimal value>`), which is just as sensitive as
  // the raw hex. This is exactly the leak this wrapping exists to close.
  const invalidKey: Hex = `0x${'f'.repeat(64)}`;

  let caught: unknown;
  try {
    new AnchorChainClient({
      rpcUrl: 'http://127.0.0.1:1',
      chainId: 31337,
      contractAddress: VALID_CONTRACT_ADDRESS,
      submitterPrivateKey: invalidKey,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof AnchorKeyConfigurationError, 'must throw the dedicated, redacted error type');
  const message = (caught as Error).message;
  assert.ok(!message.includes('f'.repeat(64)), 'the raw hex key must never appear in the error message');
  // The numeric value of the invalid key, decimal-encoded -- what viem's
  // own (discarded) error would have embedded. Confirms this specific
  // re-encoded-leak path is actually closed, not just the hex form.
  const keyAsDecimal = BigInt(invalidKey).toString(10);
  assert.ok(!message.includes(keyAsDecimal), 'a decimal re-encoding of the raw key must never appear in the error message either');
  assert.doesNotMatch(message, /0x[0-9a-f]{64}/i, 'no 32-byte hex value of any kind should appear in the error message');
});

test('a well-formed, valid private key does not throw at construction time', () => {
  // Anvil's well-known, publicly documented default dev account -- never
  // a real secret. Only proves the happy path doesn't spuriously throw;
  // no RPC call is made here.
  const validKey: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  assert.doesNotThrow(() => {
    new AnchorChainClient({ rpcUrl: 'http://127.0.0.1:1', chainId: 31337, contractAddress: VALID_CONTRACT_ADDRESS, submitterPrivateKey: validKey });
  });
});
