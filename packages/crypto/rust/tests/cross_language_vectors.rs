// SPDX-License-Identifier: Apache-2.0
//! Cross-language crypto vectors, shared with the TypeScript side via
//! packages/test-vectors/vectors/crypto-v1.json. See
//! packages/crypto/ts/src/crypto-v1.test.ts for the TypeScript half.

use ddn_crypto::{sha256_text, sign_ed25519, verify_ed25519};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-vectors/vectors/crypto-v1.json")
}

fn load() -> Value {
    let raw = fs::read_to_string(vectors_path()).expect("read crypto-v1.json");
    let value: Value = serde_json::from_str(&raw).expect("parse crypto-v1.json");
    assert_eq!(
        value["fixtureClassification"],
        "TEST-ONLY / NEVER USE IN PRODUCTION"
    );
    value
}

fn hex_to_bytes(hex_str: &str) -> Vec<u8> {
    hex::decode(hex_str).expect("valid hex")
}

#[test]
fn signing_the_vector_message_reproduces_the_recorded_signature() {
    let doc = load();
    let ed = &doc["ed25519"];
    let private_key = ed["privateKeySeedHex"].as_str().unwrap();
    let message = hex_to_bytes(ed["messageHex"].as_str().unwrap());
    let expected_signature = ed["signatureHex"].as_str().unwrap();

    let signature = sign_ed25519(private_key, &message).expect("sign");
    assert_eq!(
        signature, expected_signature,
        "Ed25519 signing is deterministic; signature must match TypeScript exactly"
    );
}

#[test]
fn valid_signature_verifies() {
    let doc = load();
    let ed = &doc["ed25519"];
    let public_key = ed["publicKeyHex"].as_str().unwrap();
    let message = hex_to_bytes(ed["messageHex"].as_str().unwrap());
    let signature = ed["signatureHex"].as_str().unwrap();
    let expected = ed["expectedVerifyResult"].as_bool().unwrap();

    assert_eq!(verify_ed25519(public_key, &message, signature), expected);
}

#[test]
fn tampered_message_fails_verification() {
    let doc = load();
    let ed = &doc["ed25519"];
    let public_key = ed["publicKeyHex"].as_str().unwrap();
    let tampered_message = hex_to_bytes(ed["tamperedMessageHex"].as_str().unwrap());
    let signature = ed["signatureHex"].as_str().unwrap();
    let expected = ed["tamperedMessageExpectedVerifyResult"].as_bool().unwrap();

    assert_eq!(
        verify_ed25519(public_key, &tampered_message, signature),
        expected
    );
}

#[test]
fn tampered_signature_fails_verification() {
    let doc = load();
    let ed = &doc["ed25519"];
    let public_key = ed["publicKeyHex"].as_str().unwrap();
    let message = hex_to_bytes(ed["messageHex"].as_str().unwrap());
    let tampered_signature = ed["tamperedSignatureHex"].as_str().unwrap();
    let expected = ed["tamperedSignatureExpectedVerifyResult"]
        .as_bool()
        .unwrap();

    assert_eq!(
        verify_ed25519(public_key, &message, tampered_signature),
        expected
    );
}

#[test]
fn wrong_public_key_fails_verification() {
    let doc = load();
    let ed = &doc["ed25519"];
    let wrong_public_key = ed["wrongPublicKeyHex"].as_str().unwrap();
    let message = hex_to_bytes(ed["messageHex"].as_str().unwrap());
    let signature = ed["signatureHex"].as_str().unwrap();
    let expected = ed["wrongPublicKeyExpectedVerifyResult"].as_bool().unwrap();

    assert_eq!(
        verify_ed25519(wrong_public_key, &message, signature),
        expected
    );
}

#[test]
fn sha256_vectors_match() {
    let doc = load();
    for vector in doc["sha256"].as_array().unwrap() {
        let text = vector["text"].as_str().unwrap();
        let expected = vector["sha256"].as_str().unwrap();
        assert_eq!(sha256_text(text), expected, "vector {}", vector["id"]);
    }
}
