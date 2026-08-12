// SPDX-License-Identifier: Apache-2.0
// @ddn/crypto
//
// SHA-256 hashing (with canonical-JSON domain separation) and Ed25519
// signing/verification. Ed25519 uses @noble/curves instead of node:crypto:
// node:crypto only exposes Ed25519 keys through DER/JWK wrappers, with no
// raw-32-byte import/export path, which makes it impractical to match the
// Rust side's raw-seed/raw-public-key representation byte for byte.
// @noble/curves is a widely audited (Cure53), zero-dependency library that
// operates on raw byte arrays directly. See docs/crypto-profile-v1.md.

import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalizeUtf8, type CanonicalJsonValue } from '@ddn/canonical-json';

export type Sha256Digest = `sha256:${string}`;

const PRIVATE_KEY_LENGTH = 32;
const PUBLIC_KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;

export type Ed25519ErrorCode =
  | 'INVALID_PRIVATE_KEY_LENGTH'
  | 'INVALID_PUBLIC_KEY_LENGTH'
  | 'INVALID_SIGNATURE_LENGTH'
  | 'INVALID_HEX_ENCODING';

export class Ed25519Error extends Error {
  readonly code: Ed25519ErrorCode;

  constructor(code: Ed25519ErrorCode, message: string) {
    super(message);
    this.name = 'Ed25519Error';
    this.code = code;
  }
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function fromHex(hex: string, expectedLength: number, code: Ed25519ErrorCode): Uint8Array {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length !== expectedLength * 2) {
    throw new Ed25519Error(code, `expected ${expectedLength}-byte lowercase hex string, got: ${hex}`);
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

export function sha256Bytes(input: Uint8Array): Sha256Digest {
  const hex = createHash('sha256').update(input).digest('hex');
  return `sha256:${hex}`;
}

export function sha256Text(input: string): Sha256Digest {
  return sha256Bytes(new TextEncoder().encode(input));
}

/**
 * Hashes `value` under an explicit domain-separated canonical JSON envelope
 * `{ "domain": domain, "value": value }`, rather than string-concatenating
 * the domain with the value's bytes. See docs/crypto-profile-v1.md for why,
 * and docs/negotiation-policy-v1.md for how this composes with the
 * `DDN_EXECUTION_V1` envelope, which is hashed directly instead (its own
 * fields already carry the domain separator).
 */
export function hashCanonicalJson(domain: string, value: CanonicalJsonValue): Sha256Digest {
  const envelope: CanonicalJsonValue = { domain, value };
  return sha256Bytes(canonicalizeUtf8(envelope));
}

// ---------------------------------------------------------------------------
// Ed25519
// ---------------------------------------------------------------------------

export interface Ed25519KeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { secretKey, publicKey } = ed25519.keygen();
  return { privateKey: toHex(secretKey), publicKey: toHex(publicKey) };
}

export function publicKeyFromPrivateKey(privateKey: string): string {
  const sk = fromHex(privateKey, PRIVATE_KEY_LENGTH, 'INVALID_PRIVATE_KEY_LENGTH');
  return toHex(ed25519.getPublicKey(sk));
}

export function signEd25519(privateKey: string, message: Uint8Array): string {
  const sk = fromHex(privateKey, PRIVATE_KEY_LENGTH, 'INVALID_PRIVATE_KEY_LENGTH');
  return toHex(ed25519.sign(message, sk));
}

/**
 * Verifies with `zip215: false` (strict RFC 8032 semantics) to match the
 * Rust side's `VerifyingKey::verify_strict`. A malformed key or signature
 * (wrong length, non-hex) returns `false` rather than throwing, matching
 * the plan's "controlled error or false" requirement.
 */
export function verifyEd25519(publicKey: string, message: Uint8Array, signature: string): boolean {
  let pk: Uint8Array;
  let sig: Uint8Array;
  try {
    pk = fromHex(publicKey, PUBLIC_KEY_LENGTH, 'INVALID_PUBLIC_KEY_LENGTH');
    sig = fromHex(signature, SIGNATURE_LENGTH, 'INVALID_SIGNATURE_LENGTH');
  } catch {
    return false;
  }
  try {
    return ed25519.verify(sig, message, pk, { zip215: false });
  } catch {
    return false;
  }
}
