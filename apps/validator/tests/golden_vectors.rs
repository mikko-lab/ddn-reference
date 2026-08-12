// SPDX-License-Identifier: Apache-2.0
//! Milestone 3 hardening: proves the committed golden protocol vectors
//! (`packages/test-vectors/vectors/validator-protocol-v1/`) actually
//! match what the validator protocol code produces today -- byte for
//! byte for the canonical JSON, exactly for every hash, the validatorId,
//! the signature envelope, and the Ed25519 signature itself. Every check
//! here compares a freshly recomputed value against a file that was
//! committed to git in advance; nothing is generated and then compared
//! to itself. `generate-golden-vectors --confirm-update` is the only
//! thing that (re)writes those files, and it is never invoked by CI --
//! see docs/validator-result-v1.md.
//!
//! Requires `scripts/build-policy.sh` to have been run first so
//! `policies/negotiation-v1/package/` exists and is current.

use ddn_validator::golden_vectors::{
    GOLDEN_VECTOR_PRIVATE_KEY, GOLDEN_VECTOR_PUBLIC_KEY, GOLDEN_VECTOR_REQUEST_ID,
    build_golden_vector_set, load_golden_vector_set,
};
use ddn_validator::identity::derive_validator_id;
use ddn_validator::load_policy;
use ddn_validator::protocol::{build_signed_result, replay_verify, verify_signature};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn policy_dir() -> PathBuf {
    repo_root().join("policies/negotiation-v1/package")
}

fn vectors_dir() -> PathBuf {
    repo_root().join("packages/test-vectors/vectors/validator-protocol-v1")
}

fn fixture_input() -> Value {
    let path = repo_root().join("packages/test-vectors/fixtures/negotiation-counter.json");
    let raw = fs::read_to_string(&path).expect("read fixture input");
    serde_json::from_str(&raw).expect("parse fixture input")
}

fn load() -> ddn_validator::LoadedPolicy {
    let dir = policy_dir();
    if !dir.join("policy.wasm").exists() {
        panic!(
            "policy package not built at {}; run scripts/build-policy.sh first",
            dir.display()
        );
    }
    load_policy(&dir, &None).expect("load policy package")
}

#[test]
fn committed_execution_request_matches_recomputed_canonical_bytes() {
    let loaded = load();
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");

    let recomputed = ddn_canonical_json::canonicalize_bytes(
        &serde_json::to_value(&committed.execution_request).unwrap(),
    )
    .unwrap();

    assert_eq!(
        recomputed, committed.canonical_request,
        "canonical bytes of the committed execution-request.json must match \
         canonical-request.txt byte-for-byte"
    );

    // Sanity: also confirm the committed request is exactly the fixed
    // vector this suite expects -- not some other, unrelated request.
    assert_eq!(
        committed.execution_request.request_id,
        GOLDEN_VECTOR_REQUEST_ID
    );
    assert_eq!(committed.execution_request.policy_hash, loaded.policy_hash);
    assert_eq!(
        committed.execution_request.profile_hash,
        loaded.profile_hash
    );
    assert_eq!(
        committed.execution_request.manifest_hash,
        loaded.manifest_hash
    );
}

#[test]
fn regenerating_the_vector_set_reproduces_every_committed_value_exactly() {
    let loaded = load();
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");
    let fresh = build_golden_vector_set(&loaded, fixture_input())
        .expect("rebuilding the golden vector set from the same policy/input must succeed");

    assert_eq!(
        fresh.canonical_request, committed.canonical_request,
        "canonical-request.txt"
    );
    assert_eq!(
        fresh.canonical_result, committed.canonical_result,
        "canonical-result.txt"
    );
    assert_eq!(
        fresh.canonical_signature_envelope, committed.canonical_signature_envelope,
        "canonical-signature-envelope.txt"
    );
    assert_eq!(fresh.input_hash, committed.input_hash, "input-hash.txt");
    assert_eq!(fresh.output_hash, committed.output_hash, "output-hash.txt");
    assert_eq!(
        fresh.execution_hash, committed.execution_hash,
        "execution-hash.txt"
    );
    assert_eq!(
        fresh.validator_id, committed.validator_id,
        "validator-id.txt"
    );
    assert_eq!(fresh.public_key, committed.public_key, "public-key.txt");
    assert_eq!(fresh.signature, committed.signature, "signature.txt");

    assert_eq!(fresh.public_key, GOLDEN_VECTOR_PUBLIC_KEY);
}

#[test]
fn committed_validator_id_is_derived_from_committed_public_key() {
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");
    let expected = derive_validator_id(&committed.public_key).unwrap();
    assert_eq!(committed.validator_id, expected);
    assert_eq!(
        committed.validator_id,
        committed.signed_validator_result.result.validator_id
    );
}

#[test]
fn committed_signature_verifies_against_committed_public_key_and_envelope() {
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");

    assert_eq!(
        committed.signature,
        committed.signed_validator_result.signature
    );
    assert_eq!(
        committed.public_key,
        committed.signed_validator_result.validator_public_key
    );

    verify_signature(&committed.signed_validator_result)
        .expect("the committed signature must verify against the committed public key");

    // The envelope actually signed must match canonical-signature-envelope.txt --
    // not just "some" canonical bytes derived from the result.
    let recomputed_envelope = ddn_canonical_json::canonicalize_bytes(&serde_json::json!({
        "domain": "DDN_VALIDATOR_RESULT_V1",
        "value": committed.signed_validator_result.result,
    }))
    .unwrap();
    assert_eq!(recomputed_envelope, committed.canonical_signature_envelope);
}

#[test]
fn committed_signed_result_replay_verifies_against_the_local_policy_package() {
    let loaded = load();
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");

    let report = replay_verify(
        &loaded,
        &committed.execution_request,
        &committed.signed_validator_result,
    );
    assert!(
        report.ok,
        "committed golden vectors must replay-verify cleanly against the local policy \
         package, got: {:?}",
        report.checks
    );
}

#[test]
fn signing_with_the_fixed_key_reproduces_the_committed_signed_result_struct() {
    let loaded = load();
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");
    let fresh = build_signed_result(
        &loaded,
        &committed.execution_request,
        GOLDEN_VECTOR_PRIVATE_KEY,
    )
    .expect("rebuilding the signed result from the committed request must succeed");

    assert_eq!(fresh.result, committed.signed_validator_result.result);
    assert_eq!(
        fresh.validator_public_key,
        committed.signed_validator_result.validator_public_key
    );
    assert_eq!(fresh.signature, committed.signed_validator_result.signature);
}

// --- "One golden-vector byte changes" must fail the test: proves these
// checks have teeth rather than trivially passing regardless of content. ---
#[test]
fn a_single_flipped_byte_in_the_committed_signature_breaks_verification() {
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");
    let mut tampered = committed.signed_validator_result.clone();
    let mut sig_bytes = tampered.signature.into_bytes();
    sig_bytes[0] = if sig_bytes[0] == b'0' { b'1' } else { b'0' };
    tampered.signature = String::from_utf8(sig_bytes).unwrap();

    assert!(
        verify_signature(&tampered).is_err(),
        "flipping one byte of the committed signature must break verification"
    );
}

#[test]
fn a_single_flipped_byte_in_the_committed_canonical_result_no_longer_matches_recomputation() {
    let loaded = load();
    let committed = load_golden_vector_set(&vectors_dir()).expect("load committed vectors");
    let fresh = build_golden_vector_set(&loaded, fixture_input()).unwrap();

    let mut tampered_canonical_result = committed.canonical_result.clone();
    let idx = tampered_canonical_result.len() / 2;
    tampered_canonical_result[idx] ^= 0x01;

    assert_ne!(
        tampered_canonical_result, fresh.canonical_result,
        "a single flipped byte in canonical-result.txt must no longer match what the \
         validator actually recomputes"
    );
}
