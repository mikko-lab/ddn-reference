// SPDX-License-Identifier: Apache-2.0
//! Cross-language canonical JSON vectors, shared with the TypeScript side
//! via `packages/test-vectors/vectors/canonical-json-v1.json`. See
//! `packages/canonical-json/ts/src/canonical-json-v1.test.ts` for the
//! TypeScript half of this same check.

use ddn_canonical_json::parse_and_canonicalize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-vectors/vectors/canonical-json-v1.json")
}

fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}

#[test]
fn valid_vectors_canonicalize_and_hash_identically() {
    let raw = fs::read_to_string(vectors_path()).expect("read canonical-json-v1.json");
    let doc: Value = serde_json::from_str(&raw).expect("parse vectors file");
    let valid = doc["valid"].as_array().expect("valid array");
    assert!(valid.len() >= 30, "expected at least 30 valid vectors");

    for vector in valid {
        let id = vector["id"].as_str().unwrap();
        let input_json = vector["inputJson"].as_str().unwrap();
        let expected_canonical = vector["canonicalJson"].as_str().unwrap();
        let expected_sha256 = vector["sha256"].as_str().unwrap();

        let (_, canonical) = parse_and_canonicalize(input_json)
            .unwrap_or_else(|e| panic!("vector {id} failed to canonicalize: {e}"));
        assert_eq!(
            canonical, expected_canonical,
            "vector {id}: canonical string mismatch"
        );
        assert_eq!(
            sha256_hex(&canonical),
            expected_sha256,
            "vector {id}: sha256 mismatch"
        );
    }
}

#[test]
fn invalid_vectors_fail_with_the_expected_error_code() {
    let raw = fs::read_to_string(vectors_path()).expect("read canonical-json-v1.json");
    let doc: Value = serde_json::from_str(&raw).expect("parse vectors file");
    let invalid = doc["invalid"].as_array().expect("invalid array");
    assert!(!invalid.is_empty());

    for vector in invalid {
        let id = vector["id"].as_str().unwrap();
        let input_json = vector["inputJson"].as_str().unwrap();
        let expected_code = vector["errorCode"].as_str().unwrap();

        match parse_and_canonicalize(input_json) {
            Ok(_) => panic!("vector {id} unexpectedly succeeded"),
            Err(err) => assert_eq!(
                err.code(),
                expected_code,
                "vector {id}: error code mismatch"
            ),
        }
    }
}
