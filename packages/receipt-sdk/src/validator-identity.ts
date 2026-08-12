// SPDX-License-Identifier: Apache-2.0
// Mirrors apps/validator/src/identity.rs (derive_validator_id) and the
// signature envelope in apps/validator/src/protocol.rs
// (validator_result_envelope_bytes/verify_signature) byte-for-byte. Must
// verify Rust-produced signatures without any transformation -- see
// docs/decision-receipt-v1.md and the cross-language golden vectors under
// packages/test-vectors/vectors/decision-receipt-v1/.

import { canonicalizeUtf8, type CanonicalJsonValue } from '@ddn/canonical-json';
import { sha256Bytes, verifyEd25519, type Sha256Digest } from '@ddn/crypto';
import { VALIDATOR_ID_DOMAIN_V1, VALIDATOR_RESULT_DOMAIN_V1, type SignedValidatorResultV1 } from './protocol-types.js';

/**
 * `validatorId = sha256(canonicalize({ domain: "DDN_VALIDATOR_ID_V1",
 * signatureAlgorithm: "ed25519", publicKey }))`.
 *
 * A flat envelope (domain alongside the other fields), not the
 * `{ domain, value }` wrapper `hashCanonicalJson` uses elsewhere -- matches
 * the Rust side's deliberate, narrower convention for this one identity
 * statement exactly.
 */
export function deriveValidatorId(publicKeyHex: string): Sha256Digest {
  const envelope: CanonicalJsonValue = {
    domain: VALIDATOR_ID_DOMAIN_V1,
    signatureAlgorithm: 'ed25519',
    publicKey: publicKeyHex,
  };
  return sha256Bytes(canonicalizeUtf8(envelope));
}

function validatorResultEnvelopeBytes(result: SignedValidatorResultV1['result']): Uint8Array {
  const envelope: CanonicalJsonValue = {
    domain: VALIDATOR_RESULT_DOMAIN_V1,
    value: result as unknown as CanonicalJsonValue,
  };
  return canonicalizeUtf8(envelope);
}

/** Verifies `signed.signature` against `signed.validatorPublicKey` over the
 * recomputed envelope bytes of `signed.result` -- the same computation
 * `ddn-validator`'s own `verify_signature`/`replay-verify` use. Returns
 * `false` on any mismatch rather than throwing. */
export function verifySignedValidatorResultSignature(signed: SignedValidatorResultV1): boolean {
  const message = validatorResultEnvelopeBytes(signed.result);
  return verifyEd25519(signed.validatorPublicKey, message, signed.signature);
}

/** True only if `signed.result.validatorId` is exactly what
 * `deriveValidatorId` computes from `signed.validatorPublicKey` -- a stale
 * or mismatched identity fails this even if the signature bytes still
 * happen to verify against some other key. */
export function validatorIdMatchesPublicKey(signed: SignedValidatorResultV1): boolean {
  return deriveValidatorId(signed.validatorPublicKey) === signed.result.validatorId;
}
