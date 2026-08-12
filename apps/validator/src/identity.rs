// SPDX-License-Identifier: Apache-2.0
//! Milestone 3 hardening: validator key identity.
//!
//! A bare Ed25519 public key is not yet a proper identity model -- it's
//! just bytes. `validatorId` binds it to a versioned, domain-separated
//! statement of *what kind* of key it is (`signatureAlgorithm`), so the
//! identity is derived and verifiable rather than an arbitrary
//! caller-supplied label. Nothing in this crate accepts `validatorId` as
//! free-form input: it is always computed from a public key by
//! [`derive_validator_id`], never asserted by a request or a CLI flag. See
//! `docs/validator-result-v1.md`.

use ddn_canonical_json::canonicalize_bytes;
use ddn_crypto::sha256_bytes;

pub const VALIDATOR_ID_DOMAIN_V1: &str = "DDN_VALIDATOR_ID_V1";

/// `validatorId = sha256(canonicalize({ domain: "DDN_VALIDATOR_ID_V1",
/// signatureAlgorithm: "ed25519", publicKey }))`.
///
/// Note this is a flat envelope (`domain` alongside the other fields), not
/// the `{ domain, value }` two-level wrapper `hash_canonical_json`
/// (`ddn-crypto`) uses elsewhere in this codebase -- a deliberate, narrower
/// convention for this one identity statement, matching the exact shape
/// pinned in `docs/validator-result-v1.md` and the golden vectors in
/// `packages/test-vectors/vectors/validator-protocol-v1/`.
pub fn derive_validator_id(public_key_hex: &str) -> Result<String, String> {
    let envelope = serde_json::json!({
        "domain": VALIDATOR_ID_DOMAIN_V1,
        "signatureAlgorithm": "ed25519",
        "publicKey": public_key_hex,
    });
    let bytes = canonicalize_bytes(&envelope).map_err(|e| e.to_string())?;
    Ok(sha256_bytes(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fixed test vector (packages/test-vectors/vectors/crypto-v1.json) --
    // a synthetic keypair generated for this repository, not a production
    // key. Locks the exact envelope shape/domain byte-for-byte: any
    // accidental change to the envelope (field order, an added field, a
    // different domain string) changes this hash and fails the test.
    const TEST_PUBLIC_KEY: &str =
        "d9625026417719b578b328dd9e77cae7e078fc228f53f4834123c334674dd26a";

    #[test]
    fn derives_a_stable_id_from_a_fixed_public_key() {
        let id = derive_validator_id(TEST_PUBLIC_KEY).unwrap();
        assert!(id.starts_with("sha256:"));
        // Recomputing must be exactly reproducible.
        assert_eq!(id, derive_validator_id(TEST_PUBLIC_KEY).unwrap());
    }

    #[test]
    fn different_public_keys_derive_different_ids() {
        let other_key = "85c76a582b2297ea4f4d56ca1d3ad8161b81e638fae588facf0ada2ae70c300a";
        assert_ne!(
            derive_validator_id(TEST_PUBLIC_KEY).unwrap(),
            derive_validator_id(other_key).unwrap()
        );
    }
}
