// SPDX-License-Identifier: Apache-2.0
//! Runs packages/test-vectors/vectors/negotiation-v1.json through the
//! native `evaluate()` function and checks decision, canonicalization, and
//! hashing all match the recorded expectations. The WASM build is checked
//! against the same file separately (apps/validator's determinism-check /
//! native-vs-wasm comparison); see docs/milestone-2-verification.md.

use ddn_canonical_json::canonicalize;
use ddn_crypto::hash_canonical_json;
use ddn_negotiation_v1::{NegotiationInputV1, evaluate};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/test-vectors/vectors/negotiation-v1.json")
}

#[test]
fn all_vectors_match_native_evaluation() {
    let raw = fs::read_to_string(vectors_path()).expect("read negotiation-v1.json");
    let doc: Value = serde_json::from_str(&raw).expect("parse negotiation-v1.json");
    let vectors = doc["vectors"].as_array().expect("vectors array");
    assert!(
        vectors.len() >= 20,
        "expected at least 20 negotiation vectors"
    );

    for vector in vectors {
        let id = vector["id"].as_str().unwrap();
        let input: NegotiationInputV1 = serde_json::from_value(vector["input"].clone())
            .unwrap_or_else(|e| panic!("vector {id}: input did not deserialize: {e}"));

        let output =
            evaluate(&input).unwrap_or_else(|e| panic!("vector {id}: evaluate failed: {e}"));
        let output_value = serde_json::to_value(&output).unwrap();

        assert_eq!(
            output_value, vector["expectedOutput"],
            "vector {id}: decision mismatch"
        );

        let canonical_input = canonicalize(&vector["input"]).unwrap();
        assert_eq!(
            canonical_input, vector["canonicalInput"],
            "vector {id}: canonicalInput mismatch"
        );

        let canonical_output = canonicalize(&output_value).unwrap();
        assert_eq!(
            canonical_output, vector["canonicalOutput"],
            "vector {id}: canonicalOutput mismatch"
        );

        let input_hash = hash_canonical_json("DDN_INPUT_V1", &vector["input"]).unwrap();
        assert_eq!(
            input_hash, vector["inputHash"],
            "vector {id}: inputHash mismatch"
        );

        let output_hash = hash_canonical_json("DDN_OUTPUT_V1", &output_value).unwrap();
        assert_eq!(
            output_hash, vector["outputHash"],
            "vector {id}: outputHash mismatch"
        );
    }
}

#[test]
fn every_decision_kind_is_covered() {
    let raw = fs::read_to_string(vectors_path()).expect("read negotiation-v1.json");
    let doc: Value = serde_json::from_str(&raw).expect("parse negotiation-v1.json");
    let vectors = doc["vectors"].as_array().unwrap();

    for decision in ["ACCEPT", "COUNTER", "REJECT", "ESCALATE"] {
        let found = vectors
            .iter()
            .any(|v| v["expectedOutput"]["decision"] == decision);
        assert!(found, "no vector covers decision {decision}");
    }
}
