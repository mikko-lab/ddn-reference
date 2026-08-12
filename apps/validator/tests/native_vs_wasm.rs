// SPDX-License-Identifier: Apache-2.0
//! Confirms native `ddn-negotiation-v1::evaluate()` and this crate's WASM
//! execution path agree on every vector in
//! `packages/test-vectors/vectors/negotiation-v1.json`: same decision,
//! same `outputHash`. Requires `scripts/build-policy.sh` to have been run
//! first so `policies/negotiation-v1/package/` exists and is current.

use ddn_validator::{execute_text, load_policy};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn wasm_execution_matches_native_evaluation_for_every_vector() {
    let policy_dir = repo_root().join("policies/negotiation-v1/package");
    if !policy_dir.join("policy.wasm").exists() {
        panic!(
            "policy package not built at {}; run scripts/build-policy.sh first",
            policy_dir.display()
        );
    }

    let vectors_path = repo_root().join("packages/test-vectors/vectors/negotiation-v1.json");
    let raw = fs::read_to_string(&vectors_path).expect("read negotiation-v1.json");
    let doc: Value = serde_json::from_str(&raw).expect("parse negotiation-v1.json");
    let vectors = doc["vectors"].as_array().expect("vectors array");

    let loaded = load_policy(&policy_dir, &None).expect("load policy package");

    for vector in vectors {
        let id = vector["id"].as_str().unwrap();
        let input_text = serde_json::to_string(&vector["input"]).unwrap();

        let result = execute_text(&loaded, &input_text)
            .unwrap_or_else(|e| panic!("vector {id}: wasm execution failed: {e}"));

        assert!(
            !result.is_error,
            "vector {id}: wasm execution returned an error envelope"
        );
        assert_eq!(
            result.output_value, vector["expectedOutput"],
            "vector {id}: wasm decision does not match native evaluate()"
        );
        assert_eq!(
            result.output_hash, vector["outputHash"],
            "vector {id}: wasm outputHash does not match native evaluate()'s canonical hash"
        );
        assert_eq!(
            result.input_hash, vector["inputHash"],
            "vector {id}: inputHash mismatch"
        );
    }
}
