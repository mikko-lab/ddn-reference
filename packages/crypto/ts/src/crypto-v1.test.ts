// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signEd25519, verifyEd25519, sha256Text } from './index.js';

// Shared with the Rust side via packages/test-vectors/vectors/crypto-v1.json.
// See packages/crypto/rust/tests/cross_language_vectors.rs.
const vectorsPath = fileURLToPath(new URL('../../../test-vectors/vectors/crypto-v1.json', import.meta.url));

interface CryptoVectors {
  fixtureClassification: 'TEST-ONLY / NEVER USE IN PRODUCTION';
  vectorVersion: string;
  ed25519: {
    privateKeySeedHex: string;
    publicKeyHex: string;
    messageHex: string;
    signatureHex: string;
    expectedVerifyResult: boolean;
    tamperedMessageHex: string;
    tamperedMessageExpectedVerifyResult: boolean;
    tamperedSignatureHex: string;
    tamperedSignatureExpectedVerifyResult: boolean;
    wrongPublicKeyHex: string;
    wrongPublicKeyExpectedVerifyResult: boolean;
  };
  sha256: { id: string; text: string; sha256: string }[];
}

const doc: CryptoVectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

test('crypto-v1: signing the vector message reproduces the recorded signature', () => {
  const { privateKeySeedHex, messageHex, signatureHex } = doc.ed25519;
  const signature = signEd25519(privateKeySeedHex, hexToBytes(messageHex));
  assert.equal(signature, signatureHex, 'Ed25519 signing is deterministic; signature must match Rust exactly');
});

test('crypto-v1: valid signature verifies', () => {
  const { publicKeyHex, messageHex, signatureHex, expectedVerifyResult } = doc.ed25519;
  assert.equal(verifyEd25519(publicKeyHex, hexToBytes(messageHex), signatureHex), expectedVerifyResult);
});

test('crypto-v1: tampered message fails verification', () => {
  const { publicKeyHex, tamperedMessageHex, signatureHex, tamperedMessageExpectedVerifyResult } = doc.ed25519;
  assert.equal(
    verifyEd25519(publicKeyHex, hexToBytes(tamperedMessageHex), signatureHex),
    tamperedMessageExpectedVerifyResult
  );
});

test('crypto-v1: tampered signature fails verification', () => {
  const { publicKeyHex, messageHex, tamperedSignatureHex, tamperedSignatureExpectedVerifyResult } = doc.ed25519;
  assert.equal(
    verifyEd25519(publicKeyHex, hexToBytes(messageHex), tamperedSignatureHex),
    tamperedSignatureExpectedVerifyResult
  );
});

test('crypto-v1: wrong public key fails verification', () => {
  const { wrongPublicKeyHex, messageHex, signatureHex, wrongPublicKeyExpectedVerifyResult } = doc.ed25519;
  assert.equal(
    verifyEd25519(wrongPublicKeyHex, hexToBytes(messageHex), signatureHex),
    wrongPublicKeyExpectedVerifyResult
  );
});

for (const vector of doc.sha256) {
  test(`crypto-v1 sha256 vector: ${vector.id}`, () => {
    assert.equal(sha256Text(vector.text), vector.sha256);
  });
}
