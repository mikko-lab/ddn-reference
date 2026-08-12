// SPDX-License-Identifier: Apache-2.0
//! TEST-ONLY / NEVER USE IN PRODUCTION.
//!
//! Milestone 3 negative tests: proves that `build_signed_result` and
//! `replay_verify` (see `apps/validator/src/protocol.rs`) actually reject
//! every kind of tampering they claim to, rather than rubber-stamping a
//! match. Each test mutates exactly one thing and asserts the specific
//! check that should catch it actually fails -- matching the project's
//! standing practice (see `scripts/policy-reproducibility-negative-tests.sh`)
//! of proving a check has teeth, not just that it exists.
//!
//! Requires `scripts/build-policy.sh` to have been run first so
//! `policies/negotiation-v1/package/` exists and is current.

use ddn_validator::protocol::{
    ExecutionRequestV1, build_signed_result, parse_execution_request,
    parse_signed_validator_result, replay_verify,
};
use ddn_validator::{LoadedPolicy, load_policy};
use serde_json::{Value, json};
use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn policy_dir() -> PathBuf {
    repo_root().join("policies/negotiation-v1/package")
}

fn load() -> LoadedPolicy {
    let dir = policy_dir();
    if !dir.join("policy.wasm").exists() {
        panic!(
            "policy package not built at {}; run scripts/build-policy.sh first",
            dir.display()
        );
    }
    load_policy(&dir, &None).expect("load policy package")
}

fn fixture_input() -> Value {
    let path = repo_root().join("packages/test-vectors/fixtures/negotiation-counter.json");
    let raw = fs::read_to_string(&path).expect("read fixture input");
    serde_json::from_str(&raw).expect("parse fixture input")
}

/// A valid ExecutionRequestV1 for the loaded policy, built the same way a
/// well-behaved caller would: real policyHash/profileHash/inputHash, all
/// independently verifiable by the validator.
fn valid_request(loaded: &LoadedPolicy) -> ExecutionRequestV1 {
    let input = fixture_input();
    let input_hash = ddn_crypto::hash_canonical_json("DDN_INPUT_V1", &input).unwrap();
    let request_json = json!({
        "schemaVersion": "1.0.0",
        "requestId": "req-negative-test-1",
        "policyId": loaded.manifest.policy_id,
        "policyVersion": loaded.manifest.policy_version,
        "policyHash": loaded.policy_hash,
        "profileHash": loaded.profile_hash,
        "manifestHash": loaded.manifest_hash,
        "input": input,
        "inputHash": input_hash,
    });
    parse_execution_request(&request_json.to_string()).expect("valid request must parse")
}

/// Copies the built policy package into a fresh temp directory (unique per
/// test, cleaned up by the caller) so a test can mutate one file without
/// disturbing the shared `policies/negotiation-v1/package/` the other
/// tests read.
fn copy_policy_package(suffix: &str) -> PathBuf {
    let src = policy_dir();
    let dst = std::env::temp_dir().join(format!(
        "ddn-validator-negtest-{suffix}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&dst);
    fs::create_dir_all(&dst).unwrap();
    for name in [
        "manifest.json",
        "policy.wasm",
        "input.schema.json",
        "output.schema.json",
        "reason-codes.json",
        "test-vectors.json",
    ] {
        fs::copy(src.join(name), dst.join(name)).unwrap();
    }
    dst
}

fn flip_first_byte(path: &std::path::Path) {
    let mut bytes = fs::read(path).unwrap();
    bytes[0] ^= 0x01;
    fs::write(path, bytes).unwrap();
}

fn assert_error_code(err: &str, code: &str) {
    assert!(
        err.starts_with(code),
        "expected error to start with {code}, got: {err}"
    );
}

// Fixed test vector (packages/test-vectors/vectors/crypto-v1.json) -- a
// synthetic keypair generated for this repository, not a production key.
// Using a fixed key (not a freshly-generated random one per test run)
// keeps these tests, and the golden protocol vectors, byte-for-byte
// reproducible across runs and machines.
const TEST_PRIVATE_KEY: &str = "d6ef35bf5f26199e80b600c4080b662e46ef6f4f094dc5420185da513a19e4b7";
const TEST_PUBLIC_KEY: &str = "d9625026417719b578b328dd9e77cae7e078fc228f53f4834123c334674dd26a";
const WRONG_PUBLIC_KEY: &str = "85c76a582b2297ea4f4d56ca1d3ad8161b81e638fae588facf0ada2ae70c300a";

fn keypair() -> (String, String) {
    (TEST_PRIVATE_KEY.to_string(), TEST_PUBLIC_KEY.to_string())
}

fn wrong_but_well_formed_hash() -> String {
    "sha256:0000000000000000000000000000000000000000000000000000000000000".to_string()
}

// --- Happy path sanity check, so every negative test below is known to be
// deviating from something that actually works. ---
#[test]
fn valid_request_produces_a_replay_verifiable_signed_result() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let signed = build_signed_result(&loaded, &request, &private_key)
        .expect("valid request should produce a signed result");
    let report = replay_verify(&loaded, &request, &signed);
    assert!(
        report.ok,
        "expected all checks to pass, got: {:?}",
        report.checks
    );
}

// --- 1. Changed input (request.input mutated, inputHash left as the old,
// now-stale value). ---
#[test]
fn changed_input_with_stale_input_hash_is_rejected() {
    let loaded = load();
    let mut request = valid_request(&loaded);
    request.input["customerOfferCents"] = json!(1); // input changes...
    // ...but inputHash is NOT recomputed, so it's now stale.
    let (private_key, _) = keypair();
    let err = build_signed_result(&loaded, &request, &private_key)
        .expect_err("changed input with stale inputHash must be rejected");
    assert!(err.contains("inputHash mismatch"), "got: {err}");
}

// --- 2. Wrong inputHash (input left alone, inputHash corrupted). ---
#[test]
fn wrong_input_hash_is_rejected() {
    let loaded = load();
    let mut request = valid_request(&loaded);
    request.input_hash = wrong_but_well_formed_hash();
    let (private_key, _) = keypair();
    let err = build_signed_result(&loaded, &request, &private_key)
        .expect_err("wrong inputHash must be rejected");
    assert!(err.contains("inputHash mismatch"), "got: {err}");
}

// --- 3. Changed policy.wasm (a byte flipped in a copy of the artifact;
// manifest.json left pointing at the original hash). ---
#[test]
fn changed_policy_wasm_is_rejected() {
    let dst = copy_policy_package("changed-wasm");
    flip_first_byte(&dst.join("policy.wasm"));

    let err = match load_policy(&dst, &None) {
        Ok(_) => panic!("corrupted policy.wasm must fail the policy hash check"),
        Err(e) => e,
    };
    assert_error_code(&err, "POLICY_HASH_MISMATCH");

    let _ = fs::remove_dir_all(&dst);
}

// --- Changed input.schema.json. ---
#[test]
fn changed_input_schema_is_rejected() {
    let dst = copy_policy_package("changed-input-schema");
    flip_first_byte(&dst.join("input.schema.json"));

    let err = match load_policy(&dst, &None) {
        Ok(_) => panic!("corrupted input.schema.json must fail the schema hash check"),
        Err(e) => e,
    };
    assert_error_code(&err, "SCHEMA_HASH_MISMATCH");

    let _ = fs::remove_dir_all(&dst);
}

// --- Changed output.schema.json. ---
#[test]
fn changed_output_schema_is_rejected() {
    let dst = copy_policy_package("changed-output-schema");
    flip_first_byte(&dst.join("output.schema.json"));

    let err = match load_policy(&dst, &None) {
        Ok(_) => panic!("corrupted output.schema.json must fail the schema hash check"),
        Err(e) => e,
    };
    assert_error_code(&err, "SCHEMA_HASH_MISMATCH");

    let _ = fs::remove_dir_all(&dst);
}

// --- Changed reason-codes.json (the reason-code registry). ---
#[test]
fn changed_reason_code_registry_is_rejected() {
    let dst = copy_policy_package("changed-reason-codes");
    flip_first_byte(&dst.join("reason-codes.json"));

    let err = match load_policy(&dst, &None) {
        Ok(_) => panic!("corrupted reason-codes.json must fail the schema hash check"),
        Err(e) => e,
    };
    assert_error_code(&err, "SCHEMA_HASH_MISMATCH");

    let _ = fs::remove_dir_all(&dst);
}

// --- Changed manifest.json itself (a field that isn't cross-checked
// against any file hash, so this is caught only by manifestHash -- not by
// the policy/schema hash checks, which would still all pass). ---
#[test]
fn changed_manifest_byte_changes_manifest_hash() {
    let dst = copy_policy_package("changed-manifest");
    let manifest_path = dst.join("manifest.json");
    let text = fs::read_to_string(&manifest_path).unwrap();
    let mut value: Value = serde_json::from_str(&text).unwrap();
    value["publisherId"] = json!("a-different-publisher");
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&value).unwrap(),
    )
    .unwrap();

    let original = load();
    let mutated = load_policy(&dst, &None).expect("mutated manifest still parses and hash-checks");
    assert_ne!(
        original.manifest_hash, mutated.manifest_hash,
        "changing a manifest field not covered by any *Hash check must still change manifestHash"
    );

    let _ = fs::remove_dir_all(&dst);
}

// --- Wrong manifestHash claim (request claims the *original* package's
// manifestHash against a package whose manifest.json has changed). ---
#[test]
fn wrong_manifest_hash_claim_is_rejected() {
    let loaded = load();
    let dst = copy_policy_package("wrong-manifest-hash-claim");
    let manifest_path = dst.join("manifest.json");
    let text = fs::read_to_string(&manifest_path).unwrap();
    let mut value: Value = serde_json::from_str(&text).unwrap();
    value["publisherId"] = json!("a-different-publisher");
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&value).unwrap(),
    )
    .unwrap();
    let mutated_loaded = load_policy(&dst, &None).unwrap();

    // Request claims the *original* manifestHash, but we run it against
    // the mutated package.
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let err = build_signed_result(&mutated_loaded, &request, &private_key)
        .expect_err("manifestHash claim mismatch must be rejected");
    assert_error_code(&err, "MANIFEST_HASH_MISMATCH");

    let _ = fs::remove_dir_all(&dst);
}

// --- Wrong policyHash claim (request claims a syntactically-valid but
// wrong policyHash). ---
#[test]
fn wrong_policy_hash_claim_is_rejected() {
    let loaded = load();
    let mut request = valid_request(&loaded);
    request.policy_hash = wrong_but_well_formed_hash();
    let (private_key, _) = keypair();
    let err = build_signed_result(&loaded, &request, &private_key)
        .expect_err("wrong policyHash claim must be rejected");
    assert_error_code(&err, "POLICY_HASH_MISMATCH");
}

// --- Correct hash claim, but the *local* artifact (execution profile) has
// changed since the request was built: the request is internally
// consistent and matches what the policy was *originally* pinned to, but
// no longer matches what's actually on disk now. ---
#[test]
fn correct_claim_but_changed_local_profile_artifact_is_rejected() {
    let loaded = load();
    let request = valid_request(&loaded); // profileHash claim = the *original* profile.

    let profiles_dir = std::env::temp_dir().join(format!(
        "ddn-validator-negtest-changed-profile-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&profiles_dir);
    fs::create_dir_all(&profiles_dir).unwrap();
    let src_profile = ddn_validator::default_profiles_dir()
        .join(format!("{}.json", loaded.manifest.execution_profile_id));
    let dst_profile = profiles_dir.join(format!("{}.json", loaded.manifest.execution_profile_id));
    fs::copy(&src_profile, &dst_profile).unwrap();
    let text = fs::read_to_string(&dst_profile).unwrap();
    let mut value: Value = serde_json::from_str(&text).unwrap();
    value["fuelLimit"] = json!(value["fuelLimit"].as_u64().unwrap() + 1);
    fs::write(&dst_profile, serde_json::to_string_pretty(&value).unwrap()).unwrap();

    // Load the policy again, but pointed at the *changed* local profile --
    // matching the same executionProfileId, so this is exactly "the local
    // artifact changed underneath an otherwise-correct request", not a
    // wrong claim in the request itself.
    let loaded_with_changed_profile =
        load_policy(&policy_dir(), &Some(dst_profile.clone())).unwrap();

    let (private_key, _) = keypair();
    let err = build_signed_result(&loaded_with_changed_profile, &request, &private_key).expect_err(
        "a request whose profileHash claim no longer matches the local artifact must be rejected",
    );
    assert_error_code(&err, "PROFILE_HASH_MISMATCH");

    let _ = fs::remove_dir_all(&profiles_dir);
}

// --- 4. Wrong profileHash. ---
#[test]
fn wrong_profile_hash_is_rejected() {
    let loaded = load();
    let mut request = valid_request(&loaded);
    request.profile_hash = wrong_but_well_formed_hash();
    let (private_key, _) = keypair();
    let err = build_signed_result(&loaded, &request, &private_key)
        .expect_err("wrong profileHash must be rejected");
    assert_error_code(&err, "PROFILE_HASH_MISMATCH");
}

// --- 5. Changed output (tampered post-signing, outputHash/executionHash
// left as the original, now-stale values). ---
#[test]
fn changed_output_is_caught_by_replay() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let mut signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    signed.result.output = json!({"decision": "ACCEPT", "counterOfferCents": null, "reasonCodes": [], "humanReviewRequired": false});

    let report = replay_verify(&loaded, &request, &signed);
    assert!(!report.ok);
    assert_check_failed(&report, "outputMatches");
}

// --- 6. Wrong outputHash. ---
#[test]
fn wrong_output_hash_is_caught_by_replay() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let mut signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    signed.result.output_hash = wrong_but_well_formed_hash();

    let report = replay_verify(&loaded, &request, &signed);
    assert!(!report.ok);
    assert_check_failed(&report, "outputHashMatches");
}

// --- 7. Changed executionHash. ---
#[test]
fn wrong_execution_hash_is_caught_by_replay() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let mut signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    signed.result.execution_hash = wrong_but_well_formed_hash();

    let report = replay_verify(&loaded, &request, &signed);
    assert!(!report.ok);
    assert_check_failed(&report, "executionHashMatches");
}

// --- 8. Wrong public key (a different, validly-formed Ed25519 key). ---
#[test]
fn wrong_public_key_is_rejected() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let mut signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    signed.validator_public_key = WRONG_PUBLIC_KEY.to_string();

    let report = replay_verify(&loaded, &request, &signed);
    assert!(!report.ok);
    assert_check_failed(&report, "signatureValid");
    // The swapped-in public key also derives a different validatorId than
    // the one that was actually signed -- a mismatched identity, not just
    // an invalid signature, and caught independently by its own check.
    assert_check_failed(&report, "validatorIdMatchesPublicKey");
}

// --- validatorId doesn't match the embedded public key: the public key is
// swapped after signing (as above), but here we additionally confirm the
// *specific* identity check fails even in isolation -- i.e. it isn't
// merely riding on signatureValid also failing for the same mutation. ---
#[test]
fn validator_id_not_matching_public_key_is_rejected() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    assert_eq!(
        signed.result.validator_id,
        ddn_validator::identity::derive_validator_id(TEST_PUBLIC_KEY).unwrap(),
        "sanity check: signed result's validatorId must be derived from the real signing key"
    );

    let mut tampered = signed;
    tampered.validator_public_key = WRONG_PUBLIC_KEY.to_string();
    // validatorId left as-is: now stale relative to the swapped-in key.

    let report = replay_verify(&loaded, &request, &tampered);
    assert_check_failed(&report, "validatorIdMatchesPublicKey");
}

// --- 9. Broken signature (one hex character flipped). ---
#[test]
fn broken_signature_is_rejected() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let mut signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    let mut sig_bytes = signed.signature.into_bytes();
    sig_bytes[0] = if sig_bytes[0] == b'0' { b'1' } else { b'0' };
    signed.signature = String::from_utf8(sig_bytes).unwrap();

    let report = replay_verify(&loaded, &request, &signed);
    assert!(!report.ok);
    assert_check_failed(&report, "signatureValid");
}

// --- 10. Unknown schemaVersion. ---
#[test]
fn unknown_schema_version_is_rejected_on_request() {
    let loaded = load();
    let input = fixture_input();
    let input_hash = ddn_crypto::hash_canonical_json("DDN_INPUT_V1", &input).unwrap();
    let request_json = json!({
        "schemaVersion": "99.0.0",
        "requestId": "req-negative-test-schema",
        "policyId": loaded.manifest.policy_id,
        "policyVersion": loaded.manifest.policy_version,
        "policyHash": loaded.policy_hash,
        "profileHash": loaded.profile_hash,
        "manifestHash": loaded.manifest_hash,
        "input": input,
        "inputHash": input_hash,
    });
    let err = parse_execution_request(&request_json.to_string())
        .expect_err("unknown schemaVersion must be rejected");
    assert!(err.contains("schemaVersion"), "got: {err}");
}

#[test]
fn unknown_schema_version_is_rejected_on_signed_result() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    let mut value = serde_json::to_value(&signed).unwrap();
    value["result"]["schemaVersion"] = json!("99.0.0");

    let err = parse_signed_validator_result(&value.to_string())
        .expect_err("unknown schemaVersion must be rejected");
    assert!(err.contains("schemaVersion"), "got: {err}");
}

// --- 11. Extra unknown field. ---
#[test]
fn extra_unknown_field_is_rejected_on_request() {
    let loaded = load();
    let input = fixture_input();
    let input_hash = ddn_crypto::hash_canonical_json("DDN_INPUT_V1", &input).unwrap();
    let request_json = json!({
        "schemaVersion": "1.0.0",
        "requestId": "req-negative-test-extra-field",
        "policyId": loaded.manifest.policy_id,
        "policyVersion": loaded.manifest.policy_version,
        "policyHash": loaded.policy_hash,
        "profileHash": loaded.profile_hash,
        "manifestHash": loaded.manifest_hash,
        "input": input,
        "inputHash": input_hash,
        "unexpectedField": "should not be accepted",
    });
    parse_execution_request(&request_json.to_string())
        .expect_err("extra unknown field must be rejected");
}

#[test]
fn extra_unknown_field_is_rejected_on_signed_result() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, _) = keypair();
    let signed = build_signed_result(&loaded, &request, &private_key).unwrap();
    let mut value = serde_json::to_value(&signed).unwrap();
    value["unexpectedField"] = json!("should not be accepted");

    parse_signed_validator_result(&value.to_string())
        .expect_err("extra unknown field must be rejected");
}

// Also confirm sign_validator_result derives validatorPublicKey from the
// signing key itself, not from a caller-supplied value -- there's no field
// for a caller to lie about here, but this documents/locks that invariant.
#[test]
fn signed_result_public_key_is_derived_not_asserted() {
    let loaded = load();
    let request = valid_request(&loaded);
    let (private_key, expected_public_key) = keypair();
    let result = build_signed_result(&loaded, &request, &private_key).unwrap();
    let expected_public_key_via_helper = expected_public_key;
    assert_eq!(result.validator_public_key, expected_public_key_via_helper);
}

fn assert_check_failed(report: &ddn_validator::protocol::ReplayReport, name: &str) {
    let check = report
        .checks
        .iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no check named {name} found in report: {:?}", report.checks));
    assert!(
        !check.passed,
        "expected check {name} to fail, but it passed"
    );
}
