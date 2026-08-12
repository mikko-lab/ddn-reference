// SPDX-License-Identifier: Apache-2.0
//! Milestone 3 hardening: policy package pinning.
//!
//! The validator accepts only a whole, internally consistent policy
//! package: every hash the manifest declares (`policy.wasm`, both
//! schemas, the reason-code registry, the test vectors) is recomputed
//! from the actual files on disk and compared against what the manifest
//! claims, and a request's `policyHash`/`profileHash`/`manifestHash`
//! claims are compared against those independently recomputed values --
//! never trusted as-is. Every failure mode fails closed with one of five
//! specific codes rather than a generic error, so callers can match on
//! *why* a package or request was rejected. See
//! `docs/validator-result-v1.md`.

use ddn_crypto::sha256_bytes;
use std::fmt;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyPackageError {
    /// The manifest itself doesn't parse, is missing a required field,
    /// carries an unrecognized one, or a file it references is missing or
    /// unreadable. The package as a whole cannot be trusted.
    PolicyPackageInvalid(String),
    /// `policy.wasm`'s actual bytes don't hash to what the manifest
    /// declares, or a caller's `policyHash` claim doesn't match the
    /// validator's own independently-recomputed value.
    PolicyHashMismatch(String),
    /// A caller's `profileHash` claim doesn't match the execution
    /// profile's actual, independently-recomputed canonical hash.
    ProfileHashMismatch(String),
    /// `input.schema.json`, `output.schema.json`, `reason-codes.json`, or
    /// `test-vectors.json`'s actual bytes don't hash to what the manifest
    /// declares.
    SchemaHashMismatch(String),
    /// A caller's `manifestHash` claim doesn't match the manifest's own
    /// independently-recomputed canonical hash (excluding `createdAt`,
    /// which is expected to vary between otherwise-identical builds --
    /// see `docs/reproducible-builds.md`).
    ManifestHashMismatch(String),
}

impl PolicyPackageError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::PolicyPackageInvalid(_) => "POLICY_PACKAGE_INVALID",
            Self::PolicyHashMismatch(_) => "POLICY_HASH_MISMATCH",
            Self::ProfileHashMismatch(_) => "PROFILE_HASH_MISMATCH",
            Self::SchemaHashMismatch(_) => "SCHEMA_HASH_MISMATCH",
            Self::ManifestHashMismatch(_) => "MANIFEST_HASH_MISMATCH",
        }
    }

    fn detail(&self) -> &str {
        match self {
            Self::PolicyPackageInvalid(d)
            | Self::PolicyHashMismatch(d)
            | Self::ProfileHashMismatch(d)
            | Self::SchemaHashMismatch(d)
            | Self::ManifestHashMismatch(d) => d,
        }
    }
}

impl fmt::Display for PolicyPackageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code(), self.detail())
    }
}

impl std::error::Error for PolicyPackageError {}

// Existing `Result<_, String>`-returning functions throughout this crate
// (main.rs subcommands, protocol.rs) keep working with `?` unchanged: the
// error code is preserved as the message's prefix (`Display` above), just
// no longer pattern-matchable as a distinct variant once converted.
impl From<PolicyPackageError> for String {
    fn from(e: PolicyPackageError) -> String {
        e.to_string()
    }
}

pub fn sha256_file(path: &Path) -> Result<String, PolicyPackageError> {
    let bytes = fs::read(path).map_err(|e| {
        PolicyPackageError::PolicyPackageInvalid(format!("failed to read {}: {e}", path.display()))
    })?;
    Ok(sha256_bytes(&bytes))
}

/// Compares an artifact's freshly-recomputed hash against what the
/// manifest declares for it. `label` is only used in the error message.
pub fn verify_schema_hash(
    label: &str,
    claimed: &str,
    actual: &str,
) -> Result<(), PolicyPackageError> {
    if claimed != actual {
        return Err(PolicyPackageError::SchemaHashMismatch(format!(
            "{label}: claimed {claimed}, actual is {actual}"
        )));
    }
    Ok(())
}

/// All three `verify_*_hash` functions below share the same argument
/// convention: `claimed` is the value being checked (a manifest's
/// self-declared hash, or an untrusted caller's claim), `actual` is the
/// independently, freshly-recomputed ground truth it's checked against.
pub fn verify_policy_hash(claimed: &str, actual: &str) -> Result<(), PolicyPackageError> {
    if claimed != actual {
        return Err(PolicyPackageError::PolicyHashMismatch(format!(
            "claimed {claimed}, actual is {actual}"
        )));
    }
    Ok(())
}

pub fn verify_profile_hash(claimed: &str, actual: &str) -> Result<(), PolicyPackageError> {
    if claimed != actual {
        return Err(PolicyPackageError::ProfileHashMismatch(format!(
            "claimed {claimed}, loaded execution profile is {actual}"
        )));
    }
    Ok(())
}

pub fn verify_manifest_hash(claimed: &str, actual: &str) -> Result<(), PolicyPackageError> {
    if claimed != actual {
        return Err(PolicyPackageError::ManifestHashMismatch(format!(
            "claimed {claimed}, loaded manifest is {actual}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_match_the_pinned_five() {
        assert_eq!(
            PolicyPackageError::PolicyPackageInvalid(String::new()).code(),
            "POLICY_PACKAGE_INVALID"
        );
        assert_eq!(
            PolicyPackageError::PolicyHashMismatch(String::new()).code(),
            "POLICY_HASH_MISMATCH"
        );
        assert_eq!(
            PolicyPackageError::ProfileHashMismatch(String::new()).code(),
            "PROFILE_HASH_MISMATCH"
        );
        assert_eq!(
            PolicyPackageError::SchemaHashMismatch(String::new()).code(),
            "SCHEMA_HASH_MISMATCH"
        );
        assert_eq!(
            PolicyPackageError::ManifestHashMismatch(String::new()).code(),
            "MANIFEST_HASH_MISMATCH"
        );
    }

    #[test]
    fn display_starts_with_code() {
        let e = PolicyPackageError::PolicyHashMismatch("detail".to_string());
        assert_eq!(e.to_string(), "POLICY_HASH_MISMATCH: detail");
    }
}
