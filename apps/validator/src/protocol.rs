// SPDX-License-Identifier: Apache-2.0
//! Milestone 3: `ExecutionRequestV1` / `ValidatorResultV1` /
//! `SignedValidatorResultV1` — a single validator's signed, independently
//! replayable execution of a pinned policy artifact. See
//! `docs/validator-result-v1.md`.
//!
//! `executionHash` (computed in `execute_text`, `lib.rs`) is already a pure
//! function of `policyHash`/`profileHash`/`inputHash`/`outputHash` — no
//! timestamp, nonce, validator name, or hostname feeds into it. This module
//! adds the request/result/signature envelope on top without touching that
//! computation, so the determinism Milestone 2 already proved for
//! `policy.wasm` extends to "the same signed result can be produced again,
//! by anyone, from the same inputs" rather than being weakened by it.

use crate::identity::derive_validator_id;
use crate::package;
use crate::{LoadedPolicy, execute_text};
use ddn_canonical_json::canonicalize;
use ddn_crypto::{hash_canonical_json, public_key_from_private_key, sign_ed25519, verify_ed25519};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SCHEMA_VERSION_V1: &str = "1.0.0";
pub const VALIDATOR_RESULT_DOMAIN_V1: &str = "DDN_VALIDATOR_RESULT_V1";

/// A request to execute a specific pinned policy artifact against a
/// specific input. `policyHash`/`profileHash`/`inputHash` are the
/// requester's *claims*; [`build_signed_result`] independently recomputes
/// and verifies each one rather than trusting them — a request that lies
/// about any of them is rejected before the policy ever runs.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionRequestV1 {
    pub schema_version: String,
    pub request_id: String,
    pub policy_id: String,
    pub policy_version: String,
    pub policy_hash: String,
    pub profile_hash: String,
    pub manifest_hash: String,
    pub input: Value,
    pub input_hash: String,
}

/// The outcome of a validator executing an [`ExecutionRequestV1`].
/// Deliberately excludes any timestamp, nonce, validator name/hostname, or
/// runtime metadata — see the module-level note on `executionHash`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidatorResultV1 {
    pub schema_version: String,
    pub request_id: String,
    pub validator_id: String,
    pub policy_hash: String,
    pub profile_hash: String,
    pub manifest_hash: String,
    pub input_hash: String,
    pub output: Value,
    pub output_hash: String,
    pub execution_hash: String,
    pub status: String,
}

/// An Ed25519-signed [`ValidatorResultV1`]. The signature is computed over
/// the canonical JSON bytes of the domain-separated envelope
/// `{ "domain": "DDN_VALIDATOR_RESULT_V1", "value": result }` — the same
/// domain-separation pattern `hash_canonical_json` uses for hashing, but
/// signed directly rather than hashed-then-signed (ed25519-dalek hashes
/// internally; a second explicit hash would just be redundant domain
/// separation on top of domain separation).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedValidatorResultV1 {
    pub result: ValidatorResultV1,
    pub validator_public_key: String,
    pub signature_algorithm: String,
    pub signature: String,
}

/// Builds an `ExecutionRequestV1` for `input` against `loaded`, deriving
/// `policyHash`/`profileHash`/`manifestHash`/`inputHash` from the actual
/// loaded policy package and the canonicalized input -- the natural
/// inverse of the checks [`build_signed_result`] performs on the other
/// end. Used by the `build-request` CLI command and by golden vector
/// generation, so a request built this way always independently
/// replay-verifies against the same policy package it was built from.
pub fn build_execution_request(
    loaded: &LoadedPolicy,
    request_id: &str,
    input: Value,
) -> Result<ExecutionRequestV1, String> {
    let input_hash = hash_canonical_json("DDN_INPUT_V1", &input).map_err(|e| e.to_string())?;
    Ok(ExecutionRequestV1 {
        schema_version: SCHEMA_VERSION_V1.to_string(),
        request_id: request_id.to_string(),
        policy_id: loaded.manifest.policy_id.clone(),
        policy_version: loaded.manifest.policy_version.clone(),
        policy_hash: loaded.policy_hash.clone(),
        profile_hash: loaded.profile_hash.clone(),
        manifest_hash: loaded.manifest_hash.clone(),
        input,
        input_hash,
    })
}

pub fn parse_execution_request(text: &str) -> Result<ExecutionRequestV1, String> {
    let request: ExecutionRequestV1 = serde_json::from_str(text)
        .map_err(|e| format!("failed to parse ExecutionRequestV1: {e}"))?;
    if request.schema_version != SCHEMA_VERSION_V1 {
        return Err(format!(
            "unsupported ExecutionRequestV1 schemaVersion: {}",
            request.schema_version
        ));
    }
    Ok(request)
}

pub fn parse_signed_validator_result(text: &str) -> Result<SignedValidatorResultV1, String> {
    let signed: SignedValidatorResultV1 = serde_json::from_str(text)
        .map_err(|e| format!("failed to parse SignedValidatorResultV1: {e}"))?;
    if signed.result.schema_version != SCHEMA_VERSION_V1 {
        return Err(format!(
            "unsupported ValidatorResultV1 schemaVersion: {}",
            signed.result.schema_version
        ));
    }
    if signed.signature_algorithm != "ed25519" {
        return Err(format!(
            "unsupported signatureAlgorithm: {}",
            signed.signature_algorithm
        ));
    }
    Ok(signed)
}

fn validator_result_envelope_bytes(result: &ValidatorResultV1) -> Result<Vec<u8>, String> {
    let value = serde_json::to_value(result).map_err(|e| e.to_string())?;
    let envelope = serde_json::json!({
        "domain": VALIDATOR_RESULT_DOMAIN_V1,
        "value": value,
    });
    ddn_canonical_json::canonicalize_bytes(&envelope).map_err(|e| e.to_string())
}

/// Signs `result` with the Ed25519 private key (32-byte raw seed, lowercase
/// hex). `validatorPublicKey` is derived from that same key, not taken on
/// faith from a caller-supplied value -- and `result.validatorId` is
/// unconditionally overwritten with [`derive_validator_id`] of that same
/// public key before signing, regardless of whatever the caller set it to.
/// There is no code path that lets a caller assert an arbitrary
/// `validatorId` for a key it doesn't hold.
pub fn sign_validator_result(
    mut result: ValidatorResultV1,
    private_key_hex: &str,
) -> Result<SignedValidatorResultV1, String> {
    let public_key = public_key_from_private_key(private_key_hex).map_err(|e| e.to_string())?;
    result.validator_id = derive_validator_id(&public_key)?;
    let message = validator_result_envelope_bytes(&result)?;
    let signature = sign_ed25519(private_key_hex, &message).map_err(|e| e.to_string())?;
    Ok(SignedValidatorResultV1 {
        result,
        validator_public_key: public_key,
        signature_algorithm: "ed25519".to_string(),
        signature,
    })
}

/// Verifies `signed.signature` against `signed.validatorPublicKey` over the
/// recomputed envelope bytes of `signed.result`. Returns `Err` rather than
/// `bool` so callers get a distinguishable reason in error output; the
/// underlying check itself returns `false` on any malformed input rather
/// than panicking (see `ddn_crypto::verify_ed25519`).
pub fn verify_signature(signed: &SignedValidatorResultV1) -> Result<(), String> {
    let message = validator_result_envelope_bytes(&signed.result)?;
    if verify_ed25519(&signed.validator_public_key, &message, &signed.signature) {
        Ok(())
    } else {
        Err("signature verification failed".to_string())
    }
}

/// The full Milestone 3 request→signed-result flow:
/// 1. independently verify the request's `policyHash`/`profileHash` claims
///    against the already-loaded (and manifest-hash-checked) policy,
/// 2. canonicalize `input` and independently verify the request's
///    `inputHash` claim,
/// 3. execute the pinned `policy.wasm` (this is where `outputHash`/
///    `executionHash` are computed — see `execute_text` in `lib.rs`),
/// 4. build and sign the `ValidatorResultV1`.
///
/// A request that lies about any hash is rejected before step 3 — the
/// policy never runs against a request the validator can't independently
/// corroborate.
pub fn build_signed_result(
    loaded: &LoadedPolicy,
    request: &ExecutionRequestV1,
    private_key_hex: &str,
) -> Result<SignedValidatorResultV1, String> {
    package::verify_policy_hash(&request.policy_hash, &loaded.policy_hash)?;
    package::verify_profile_hash(&request.profile_hash, &loaded.profile_hash)?;
    package::verify_manifest_hash(&request.manifest_hash, &loaded.manifest_hash)?;

    let recomputed_input_hash =
        hash_canonical_json("DDN_INPUT_V1", &request.input).map_err(|e| e.to_string())?;
    if recomputed_input_hash != request.input_hash {
        return Err(format!(
            "inputHash mismatch: request claims {}, recomputed is {}",
            request.input_hash, recomputed_input_hash
        ));
    }

    let canonical_input = canonicalize(&request.input).map_err(|e| e.to_string())?;
    let execution = execute_text(loaded, &canonical_input)?;

    let result = ValidatorResultV1 {
        schema_version: SCHEMA_VERSION_V1.to_string(),
        request_id: request.request_id.clone(),
        // Overwritten with the real, derived validatorId inside
        // sign_validator_result -- never set freely here.
        validator_id: String::new(),
        policy_hash: execution.policy_hash,
        profile_hash: execution.profile_hash,
        manifest_hash: loaded.manifest_hash.clone(),
        input_hash: execution.input_hash,
        output: execution.output_value,
        output_hash: execution.output_hash,
        execution_hash: execution.execution_hash,
        status: if execution.is_error {
            "ERROR"
        } else {
            "SUCCESS"
        }
        .to_string(),
    };

    sign_validator_result(result, private_key_hex)
}

/// One named pass/fail check in a [`ReplayReport`].
#[derive(Debug, Clone, Serialize)]
pub struct ReplayCheck {
    pub name: &'static str,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayReport {
    pub ok: bool,
    pub checks: Vec<ReplayCheck>,
}

/// Independently re-derives everything in `signed` from `request` and the
/// locally-loaded policy package, trusting nothing about `signed` itself
/// except that it parsed. Every check runs (rather than short-circuiting
/// on the first failure) so a caller sees the full picture, but `ok` is
/// `true` only if every single one passed.
pub fn replay_verify(
    loaded: &LoadedPolicy,
    request: &ExecutionRequestV1,
    signed: &SignedValidatorResultV1,
) -> ReplayReport {
    let mut checks: Vec<ReplayCheck> = Vec::new();
    let mut push = |name: &'static str, passed: bool| checks.push(ReplayCheck { name, passed });

    push("signatureValid", verify_signature(signed).is_ok());
    // Re-derived from the embedded public key, not trusted from
    // signed.result.validatorId as-is: a wrong public key paired with a
    // stale (correct-looking) validatorId must be caught here even if
    // some other check missed it.
    let expected_validator_id = derive_validator_id(&signed.validator_public_key).ok();
    push(
        "validatorIdMatchesPublicKey",
        expected_validator_id.as_deref() == Some(signed.result.validator_id.as_str()),
    );
    push(
        "requestIdMatches",
        request.request_id == signed.result.request_id,
    );
    push(
        "policyHashMatchesLoadedPolicy",
        signed.result.policy_hash == loaded.policy_hash,
    );
    push(
        "policyHashMatchesRequestClaim",
        request.policy_hash == signed.result.policy_hash,
    );
    push(
        "profileHashMatchesLoadedProfile",
        signed.result.profile_hash == loaded.profile_hash,
    );
    push(
        "profileHashMatchesRequestClaim",
        request.profile_hash == signed.result.profile_hash,
    );
    push(
        "manifestHashMatchesLoadedManifest",
        signed.result.manifest_hash == loaded.manifest_hash,
    );
    push(
        "manifestHashMatchesRequestClaim",
        request.manifest_hash == signed.result.manifest_hash,
    );

    let recomputed_input_hash = hash_canonical_json("DDN_INPUT_V1", &request.input).ok();
    push(
        "inputHashMatchesRecomputedInput",
        recomputed_input_hash.as_deref() == Some(signed.result.input_hash.as_str()),
    );
    push(
        "inputHashMatchesRequestClaim",
        request.input_hash == signed.result.input_hash,
    );

    match canonicalize(&request.input)
        .map_err(|e| e.to_string())
        .and_then(|canonical_input| execute_text(loaded, &canonical_input))
    {
        Ok(execution) => {
            push(
                "outputMatches",
                execution.output_value == signed.result.output,
            );
            push(
                "outputHashMatches",
                execution.output_hash == signed.result.output_hash,
            );
            push(
                "executionHashMatches",
                execution.execution_hash == signed.result.execution_hash,
            );
        }
        Err(_) => {
            push("outputMatches", false);
            push("outputHashMatches", false);
            push("executionHashMatches", false);
        }
    }

    let ok = checks.iter().all(|c| c.passed);
    ReplayReport { ok, checks }
}
