// SPDX-License-Identifier: Apache-2.0
//! `ddn-crypto`: SHA-256 hashing (with canonical-JSON domain separation) and
//! Ed25519 signing/verification, mirroring `@ddn/crypto` on the TypeScript
//! side. See `docs/crypto-profile-v1.md`.

use ddn_canonical_json::{CanonicalJsonError, canonicalize_bytes};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fmt;

pub const PACKAGE_NAME: &str = "ddn-crypto";

const PRIVATE_KEY_LENGTH: usize = 32;
const PUBLIC_KEY_LENGTH: usize = 32;
const SIGNATURE_LENGTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ed25519Error {
    InvalidPrivateKeyLength(String),
    InvalidPublicKeyLength(String),
    InvalidSignatureLength(String),
    InvalidHexEncoding(String),
    Canonicalization(String),
}

impl Ed25519Error {
    pub fn code(&self) -> &'static str {
        match self {
            Ed25519Error::InvalidPrivateKeyLength(_) => "INVALID_PRIVATE_KEY_LENGTH",
            Ed25519Error::InvalidPublicKeyLength(_) => "INVALID_PUBLIC_KEY_LENGTH",
            Ed25519Error::InvalidSignatureLength(_) => "INVALID_SIGNATURE_LENGTH",
            Ed25519Error::InvalidHexEncoding(_) => "INVALID_HEX_ENCODING",
            Ed25519Error::Canonicalization(_) => "CANONICALIZATION_ERROR",
        }
    }
}

impl fmt::Display for Ed25519Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code())
    }
}

impl std::error::Error for Ed25519Error {}

impl From<CanonicalJsonError> for Ed25519Error {
    fn from(e: CanonicalJsonError) -> Self {
        Ed25519Error::Canonicalization(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

pub type Sha256Digest = String;

pub fn sha256_bytes(input: &[u8]) -> Sha256Digest {
    let digest = Sha256::digest(input);
    format!("sha256:{}", hex::encode(digest))
}

pub fn sha256_text(input: &str) -> Sha256Digest {
    sha256_bytes(input.as_bytes())
}

/// Hashes `value` under an explicit domain-separated canonical JSON envelope
/// `{ "domain": domain, "value": value }`. Mirrors the TypeScript side's
/// `hashCanonicalJson` exactly; see docs/crypto-profile-v1.md.
pub fn hash_canonical_json(domain: &str, value: &Value) -> Result<Sha256Digest, Ed25519Error> {
    let envelope = serde_json::json!({ "domain": domain, "value": value });
    let bytes = canonicalize_bytes(&envelope)?;
    Ok(sha256_bytes(&bytes))
}

// ---------------------------------------------------------------------------
// Ed25519
// ---------------------------------------------------------------------------

pub struct Ed25519KeyPair {
    pub public_key: String,
    pub private_key: String,
}

fn to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

fn from_hex_exact(
    hex_str: &str,
    expected_len: usize,
    err: fn(String) -> Ed25519Error,
) -> Result<Vec<u8>, Ed25519Error> {
    if hex_str.len() != expected_len * 2 || !hex_str.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(err(format!(
            "expected {expected_len}-byte lowercase hex string, got: {hex_str}"
        )));
    }
    hex::decode(hex_str)
        .map_err(|e| Ed25519Error::InvalidHexEncoding(format!("invalid hex encoding: {e}")))
}

pub fn generate_ed25519_keypair() -> Ed25519KeyPair {
    let signing_key = SigningKey::generate(&mut OsRng);
    Ed25519KeyPair {
        private_key: to_hex(&signing_key.to_bytes()),
        public_key: to_hex(signing_key.verifying_key().as_bytes()),
    }
}

pub fn public_key_from_private_key(private_key: &str) -> Result<String, Ed25519Error> {
    let seed_vec = from_hex_exact(
        private_key,
        PRIVATE_KEY_LENGTH,
        Ed25519Error::InvalidPrivateKeyLength,
    )?;
    let seed: [u8; 32] = seed_vec.try_into().expect("length checked above");
    let signing_key = SigningKey::from_bytes(&seed);
    Ok(to_hex(signing_key.verifying_key().as_bytes()))
}

pub fn sign_ed25519(private_key: &str, message: &[u8]) -> Result<String, Ed25519Error> {
    let seed_vec = from_hex_exact(
        private_key,
        PRIVATE_KEY_LENGTH,
        Ed25519Error::InvalidPrivateKeyLength,
    )?;
    let seed: [u8; 32] = seed_vec.try_into().expect("length checked above");
    let signing_key = SigningKey::from_bytes(&seed);
    let signature = signing_key.sign(message);
    Ok(to_hex(&signature.to_bytes()))
}

/// Verifies with `VerifyingKey::verify_strict`, matching the TypeScript
/// side's `zip215: false` verification mode. A malformed key or signature
/// returns `false` rather than an `Err`, matching the plan's "controlled
/// error or false" requirement and the TypeScript side's behavior.
pub fn verify_ed25519(public_key: &str, message: &[u8], signature: &str) -> bool {
    let pk_bytes = match from_hex_exact(
        public_key,
        PUBLIC_KEY_LENGTH,
        Ed25519Error::InvalidPublicKeyLength,
    ) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let sig_bytes = match from_hex_exact(
        signature,
        SIGNATURE_LENGTH,
        Ed25519Error::InvalidSignatureLength,
    ) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let pk_array: [u8; 32] = match pk_bytes.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let sig_array: [u8; 64] = match sig_bytes.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let verifying_key = match VerifyingKey::from_bytes(&pk_array) {
        Ok(k) => k,
        Err(_) => return false,
    };
    let signature = Signature::from_bytes(&sig_array);
    verifying_key.verify_strict(message, &signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaffold_exports_its_own_package_name() {
        assert_eq!(PACKAGE_NAME, "ddn-crypto");
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_text(""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sign_and_verify_round_trip() {
        let kp = generate_ed25519_keypair();
        let message = b"ddn milestone 1-2";
        let sig = sign_ed25519(&kp.private_key, message).unwrap();
        assert!(verify_ed25519(&kp.public_key, message, &sig));
    }

    #[test]
    fn tampered_message_fails_verification() {
        let kp = generate_ed25519_keypair();
        let sig = sign_ed25519(&kp.private_key, b"original").unwrap();
        assert!(!verify_ed25519(&kp.public_key, b"tampered", &sig));
    }

    #[test]
    fn public_key_from_private_key_matches_generated_pair() {
        let kp = generate_ed25519_keypair();
        assert_eq!(
            public_key_from_private_key(&kp.private_key).unwrap(),
            kp.public_key
        );
    }

    #[test]
    fn malformed_signature_length_returns_false_not_panic() {
        let kp = generate_ed25519_keypair();
        assert!(!verify_ed25519(&kp.public_key, b"msg", "deadbeef"));
    }
}
