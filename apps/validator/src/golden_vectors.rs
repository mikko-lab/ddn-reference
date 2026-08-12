// SPDX-License-Identifier: Apache-2.0
//! TEST-ONLY / NEVER USE IN PRODUCTION.
//!
//! Milestone 3 hardening: golden protocol vectors.
//!
//! `packages/test-vectors/vectors/validator-protocol-v1/` holds a fixed,
//! committed set of artifacts proving the validator protocol's canonical
//! JSON, hashes, validator identity, and Ed25519 signature never
//! silently drift -- unlike a test that generates a value and then
//! compares it to itself, every check in
//! `apps/validator/tests/golden_vectors.rs` compares a freshly recomputed
//! value against a byte-for-byte artifact that was committed to git in a
//! previous run. Changing this module's output (a field, a hash, the
//! canonical envelope) without regenerating the vectors makes that test
//! fail. See `docs/validator-result-v1.md`.
//!
//! Everything here is signed with a fixed, published, synthetic test key
//! (`packages/test-vectors/vectors/crypto-v1.json`) and a fixed
//! `requestId` -- never a randomly generated key or a clock/UUID -- so
//! regenerating the vectors from the same policy package always produces
//! byte-identical output.

use crate::LoadedPolicy;
use crate::protocol::{
    ExecutionRequestV1, SignedValidatorResultV1, VALIDATOR_RESULT_DOMAIN_V1,
    build_execution_request, build_signed_result,
};
use ddn_canonical_json::canonicalize_bytes;
use serde_json::Value;
use std::fs;
use std::path::Path;

/// TEST-ONLY / NEVER USE IN PRODUCTION.
///
/// Fixed synthetic Ed25519 test keypair
/// (`packages/test-vectors/vectors/crypto-v1.json`) -- not a production
/// key. Used only so the golden vectors are reproducible: regenerating
/// them always signs with this same key.
pub const GOLDEN_VECTOR_PRIVATE_KEY: &str =
    "d6ef35bf5f26199e80b600c4080b662e46ef6f4f094dc5420185da513a19e4b7";
pub const GOLDEN_VECTOR_PUBLIC_KEY: &str =
    "d9625026417719b578b328dd9e77cae7e078fc228f53f4834123c334674dd26a";

/// Fixed `requestId` for the golden vectors, so regenerating them never
/// depends on a clock, a random UUID, or any other source of entropy.
pub const GOLDEN_VECTOR_REQUEST_ID: &str = "req-golden-vector-1";

/// The exact set of files a golden vector directory must contain, in
/// generation order. `apps/validator/tests/golden_vectors.rs` reads every
/// one of these; `write_golden_vector_set` writes every one of these.
pub const VECTOR_FILES: &[&str] = &[
    "execution-request.json",
    "validator-result.json",
    "signed-validator-result.json",
    "canonical-request.txt",
    "canonical-result.txt",
    "canonical-signature-envelope.txt",
    "input-hash.txt",
    "output-hash.txt",
    "execution-hash.txt",
    "validator-id.txt",
    "public-key.txt",
    "signature.txt",
];

pub struct GoldenVectorSet {
    pub execution_request_json: String,
    pub validator_result_json: String,
    pub signed_validator_result_json: String,
    pub canonical_request: Vec<u8>,
    pub canonical_result: Vec<u8>,
    pub canonical_signature_envelope: Vec<u8>,
    pub input_hash: String,
    pub output_hash: String,
    pub execution_hash: String,
    pub validator_id: String,
    pub public_key: String,
    pub signature: String,
}

/// Builds the full golden vector set from a loaded policy package and a
/// fixed input -- the same `build_signed_result`/protocol code path a
/// real validator uses, run against the pinned test key and request id.
pub fn build_golden_vector_set(
    loaded: &LoadedPolicy,
    input: Value,
) -> Result<GoldenVectorSet, String> {
    let request = build_execution_request(loaded, GOLDEN_VECTOR_REQUEST_ID, input)?;
    let signed = build_signed_result(loaded, &request, GOLDEN_VECTOR_PRIVATE_KEY)?;

    let canonical_request =
        canonicalize_bytes(&serde_json::to_value(&request).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let canonical_result =
        canonicalize_bytes(&serde_json::to_value(&signed.result).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let envelope = serde_json::json!({
        "domain": VALIDATOR_RESULT_DOMAIN_V1,
        "value": signed.result,
    });
    let canonical_signature_envelope = canonicalize_bytes(&envelope).map_err(|e| e.to_string())?;

    Ok(GoldenVectorSet {
        execution_request_json: serde_json::to_string_pretty(&request)
            .map_err(|e| e.to_string())?,
        validator_result_json: serde_json::to_string_pretty(&signed.result)
            .map_err(|e| e.to_string())?,
        signed_validator_result_json: serde_json::to_string_pretty(&signed)
            .map_err(|e| e.to_string())?,
        canonical_request,
        canonical_result,
        canonical_signature_envelope,
        input_hash: signed.result.input_hash.clone(),
        output_hash: signed.result.output_hash.clone(),
        execution_hash: signed.result.execution_hash.clone(),
        validator_id: signed.result.validator_id.clone(),
        public_key: signed.validator_public_key.clone(),
        signature: signed.signature.clone(),
    })
}

/// Writes a [`GoldenVectorSet`] to `dir`, one file per [`VECTOR_FILES`]
/// entry. The single-value `.txt` files (hashes, id, key, signature)
/// contain exactly the value and nothing else -- no trailing newline --
/// so a byte-for-byte comparison in tests is a plain equality check, not
/// a trim-then-compare.
pub fn write_golden_vector_set(dir: &Path, set: &GoldenVectorSet) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("execution-request.json"),
        &set.execution_request_json,
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        dir.join("validator-result.json"),
        &set.validator_result_json,
    )
    .map_err(|e| e.to_string())?;
    fs::write(
        dir.join("signed-validator-result.json"),
        &set.signed_validator_result_json,
    )
    .map_err(|e| e.to_string())?;
    fs::write(dir.join("canonical-request.txt"), &set.canonical_request)
        .map_err(|e| e.to_string())?;
    fs::write(dir.join("canonical-result.txt"), &set.canonical_result)
        .map_err(|e| e.to_string())?;
    fs::write(
        dir.join("canonical-signature-envelope.txt"),
        &set.canonical_signature_envelope,
    )
    .map_err(|e| e.to_string())?;
    fs::write(dir.join("input-hash.txt"), &set.input_hash).map_err(|e| e.to_string())?;
    fs::write(dir.join("output-hash.txt"), &set.output_hash).map_err(|e| e.to_string())?;
    fs::write(dir.join("execution-hash.txt"), &set.execution_hash).map_err(|e| e.to_string())?;
    fs::write(dir.join("validator-id.txt"), &set.validator_id).map_err(|e| e.to_string())?;
    fs::write(dir.join("public-key.txt"), &set.public_key).map_err(|e| e.to_string())?;
    fs::write(dir.join("signature.txt"), &set.signature).map_err(|e| e.to_string())?;
    Ok(())
}

/// Reads a committed golden vector set back from `dir`.
pub struct LoadedVectorSet {
    pub execution_request: ExecutionRequestV1,
    pub signed_validator_result: SignedValidatorResultV1,
    pub canonical_request: Vec<u8>,
    pub canonical_result: Vec<u8>,
    pub canonical_signature_envelope: Vec<u8>,
    pub input_hash: String,
    pub output_hash: String,
    pub execution_hash: String,
    pub validator_id: String,
    pub public_key: String,
    pub signature: String,
}

pub fn load_golden_vector_set(dir: &Path) -> Result<LoadedVectorSet, String> {
    let read_text = |name: &str| -> Result<String, String> {
        fs::read_to_string(dir.join(name)).map_err(|e| format!("failed to read {name}: {e}"))
    };
    let read_bytes = |name: &str| -> Result<Vec<u8>, String> {
        fs::read(dir.join(name)).map_err(|e| format!("failed to read {name}: {e}"))
    };

    let execution_request =
        crate::protocol::parse_execution_request(&read_text("execution-request.json")?)?;
    let signed_validator_result = crate::protocol::parse_signed_validator_result(&read_text(
        "signed-validator-result.json",
    )?)?;

    Ok(LoadedVectorSet {
        execution_request,
        signed_validator_result,
        canonical_request: read_bytes("canonical-request.txt")?,
        canonical_result: read_bytes("canonical-result.txt")?,
        canonical_signature_envelope: read_bytes("canonical-signature-envelope.txt")?,
        input_hash: read_text("input-hash.txt")?,
        output_hash: read_text("output-hash.txt")?,
        execution_hash: read_text("execution-hash.txt")?,
        validator_id: read_text("validator-id.txt")?,
        public_key: read_text("public-key.txt")?,
        signature: read_text("signature.txt")?,
    })
}
