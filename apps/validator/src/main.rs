// SPDX-License-Identifier: Apache-2.0
//! `ddn-validator`: a deterministic runner CLI for DDN policy packages, and
//! (Milestone 3) a validator that signs its executions and lets anyone
//! replay-verify them offline. It intentionally does not implement HTTP, a
//! database, a coordinator, or a validator network/quorum — see
//! `docs/execution-profile-v1.md` and `docs/validator-result-v1.md`. Core
//! logic lives in `lib.rs`/`protocol.rs` so it can be exercised by
//! integration tests too.

use clap::{Parser, Subcommand};
use ddn_crypto::generate_ed25519_keypair;
use ddn_validator::golden_vectors::{build_golden_vector_set, write_golden_vector_set};
use ddn_validator::identity::derive_validator_id;
use ddn_validator::protocol::{
    build_execution_request, build_signed_result, parse_execution_request,
    parse_signed_validator_result, replay_verify,
};
use ddn_validator::{LoadedPolicy, execute, load_policy};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "ddn-validator")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run a policy package once against a single canonical JSON input.
    Run {
        #[arg(long)]
        policy: PathBuf,
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        profile: Option<PathBuf>,
    },
    /// Run a policy package N times against the same input and confirm
    /// every run produces an identical canonical output, outputHash, and
    /// executionHash.
    DeterminismCheck {
        #[arg(long)]
        policy: PathBuf,
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        profile: Option<PathBuf>,
        #[arg(long, default_value_t = 100)]
        runs: u32,
    },
    /// Generate an Ed25519 validator keypair. The private key (32-byte raw
    /// seed, hex) is never printed to stdout by default -- pass
    /// --private-key-out to write it to a file, matching the project's
    /// convention of not putting secrets in shell history or process
    /// listings.
    Keygen {
        #[arg(long)]
        private_key_out: PathBuf,
    },
    /// Build an ExecutionRequestV1 for a raw input against a pinned policy
    /// package, deriving policyHash/profileHash/manifestHash/inputHash from
    /// the actual loaded package rather than requiring the caller to
    /// compute them by hand. Prints the request as canonical-ready JSON to
    /// stdout; pipe it to a file and pass that to `execute`.
    BuildRequest {
        #[arg(long)]
        policy: PathBuf,
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        request_id: String,
        #[arg(long)]
        profile: Option<PathBuf>,
    },
    /// Execute an ExecutionRequestV1 against a pinned policy package and
    /// print a signed ValidatorResultV1 (SignedValidatorResultV1) as
    /// canonical JSON. Independently verifies the request's
    /// policyHash/profileHash/inputHash claims before running anything --
    /// see docs/validator-result-v1.md.
    Execute {
        #[arg(long)]
        policy: PathBuf,
        #[arg(long)]
        request: PathBuf,
        #[arg(long)]
        profile: Option<PathBuf>,
        #[arg(long)]
        private_key_file: PathBuf,
    },
    /// Independently re-derive and check a SignedValidatorResultV1: verify
    /// the signature, recompute every hash from the original request and a
    /// local policy package, and re-run policy.wasm -- trusting nothing
    /// about the signed result itself except that it parses. Exits 0 only
    /// if every single check passes.
    ReplayVerify {
        #[arg(long)]
        policy: PathBuf,
        #[arg(long)]
        request: PathBuf,
        #[arg(long)]
        signed_result: PathBuf,
        #[arg(long)]
        profile: Option<PathBuf>,
    },
    /// Derive and print the validatorId for a public key, without needing
    /// the corresponding private key at all. `--public-key` is a file
    /// containing the lowercase-hex public key (as printed by `keygen`),
    /// matching the project's convention of reading secrets/keys from
    /// files rather than passing them as arguments.
    InspectKey {
        #[arg(long)]
        public_key: PathBuf,
    },
    /// Regenerate the committed golden protocol vectors
    /// (`packages/test-vectors/vectors/validator-protocol-v1/`) from a
    /// pinned test key/request id against the given policy package and
    /// input. Requires `--confirm-update` -- there is no default,
    /// argument-less form -- and must never be run by CI: these vectors
    /// are meant to be a fixed, git-reviewed artifact that tests compare
    /// *against*, not something regenerated on every run. See "Golden
    /// protocol vectors" in docs/validator-result-v1.md.
    GenerateGoldenVectors {
        #[arg(long)]
        policy: PathBuf,
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        out_dir: PathBuf,
        #[arg(long)]
        profile: Option<PathBuf>,
        #[arg(long)]
        confirm_update: bool,
    },
}

fn print_result(loaded: &LoadedPolicy, result: &ddn_validator::ExecutionResult) {
    let status = if result.is_error { "ERROR" } else { "SUCCESS" };
    let payload = serde_json::json!({
        "status": status,
        "policyId": loaded.manifest.policy_id,
        "policyVersion": loaded.manifest.policy_version,
        "inputHash": result.input_hash,
        "policyHash": result.policy_hash,
        "profileHash": result.profile_hash,
        "outputHash": result.output_hash,
        "executionHash": result.execution_hash,
        "output": result.output_value,
    });
    println!("{}", serde_json::to_string_pretty(&payload).unwrap());
}

fn run_determinism_check(
    policy: &Path,
    input: &Path,
    profile: &Option<PathBuf>,
    runs: u32,
) -> Result<(), String> {
    let loaded = load_policy(policy, profile)?;
    let first = execute(&loaded, input)?;
    for run_index in 1..runs {
        let result = execute(&loaded, input)?;
        if result.output_hash != first.output_hash || result.execution_hash != first.execution_hash
        {
            let report = serde_json::json!({
                "status": "DETERMINISM_FAILURE",
                "failedAtRun": run_index + 1,
                "totalRuns": runs,
                "firstOutputHash": first.output_hash,
                "firstExecutionHash": first.execution_hash,
                "divergentOutputHash": result.output_hash,
                "divergentExecutionHash": result.execution_hash,
            });
            println!("{}", serde_json::to_string_pretty(&report).unwrap());
            return Err(format!("determinism check failed at run {}", run_index + 1));
        }
    }
    let report = serde_json::json!({
        "status": "DETERMINISM_OK",
        "totalRuns": runs,
        "outputHash": first.output_hash,
        "executionHash": first.execution_hash,
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    Ok(())
}

fn public_key_path_for(private_key_out: &Path) -> PathBuf {
    private_key_out.with_extension("pub")
}

fn run_keygen(private_key_out: &Path) -> Result<(), String> {
    let keypair = generate_ed25519_keypair();
    write_private_key_securely(private_key_out, keypair.private_key.as_bytes())?;
    let public_key_out = public_key_path_for(private_key_out);
    let mut public_key_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&public_key_out)
        .map_err(|e| format!("failed to create public key file: {e}"))?;
    public_key_file
        .write_all(keypair.public_key.as_bytes())
        .map_err(|e| format!("failed to write public key: {e}"))?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "publicKey": keypair.public_key,
            "privateKeyWrittenTo": private_key_out,
            "publicKeyWrittenTo": public_key_out,
        }))
        .unwrap()
    );
    Ok(())
}

/// Creates a new private-key file with mode 0600 atomically at file
/// creation time. `create_new` also refuses to overwrite an existing key.
#[cfg(unix)]
fn write_private_key_securely(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("failed to create private key file: {e}"))?;
    file.write_all(bytes)
        .map_err(|e| format!("failed to write private key: {e}"))
}

#[cfg(not(unix))]
fn write_private_key_securely(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("failed to create private key file: {e}"))?;
    file.write_all(bytes)
        .map_err(|e| format!("failed to write private key: {e}"))
}

/// Rejects a private key file that's readable/writable by anyone other
/// than its owner (mode bits outside 0600) on Unix, before the key is
/// ever read into memory. There's no way to un-leak a private key that a
/// group/world-readable file may have already exposed, but refusing to
/// use it stops the validator from signing anything with a key it should
/// no longer trust.
#[cfg(unix)]
fn check_private_key_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::metadata(path)
        .map_err(|e| format!("failed to stat private key file {}: {e}", path.display()))?;
    let mode = metadata.permissions().mode() & 0o777;
    if mode & 0o077 != 0 {
        return Err(format!(
            "private key file {} is readable/writable by group or others (mode {:o}); \
             refusing to use it -- run `chmod 600 {}`",
            path.display(),
            mode,
            path.display()
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn check_private_key_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn read_private_key(path: &Path) -> Result<String, String> {
    check_private_key_permissions(path)?;
    let text = fs::read_to_string(path)
        .map_err(|e| format!("failed to read private key file {}: {e}", path.display()))?;
    Ok(text.trim().to_string())
}

fn run_build_request(
    policy: &Path,
    input_path: &Path,
    request_id: &str,
    profile: &Option<PathBuf>,
) -> Result<(), String> {
    let loaded = load_policy(policy, profile)?;
    let input_text =
        fs::read_to_string(input_path).map_err(|e| format!("failed to read input file: {e}"))?;
    let input: serde_json::Value =
        serde_json::from_str(&input_text).map_err(|e| format!("failed to parse input: {e}"))?;
    let request = build_execution_request(&loaded, request_id, input)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::to_value(&request).unwrap()).unwrap()
    );
    Ok(())
}

fn run_execute(
    policy: &Path,
    request_path: &Path,
    profile: &Option<PathBuf>,
    private_key_file: &Path,
) -> Result<bool, String> {
    let loaded = load_policy(policy, profile)?;
    let request_text = fs::read_to_string(request_path)
        .map_err(|e| format!("failed to read request file: {e}"))?;
    let request = parse_execution_request(&request_text)?;
    let private_key = read_private_key(private_key_file)?;
    let signed = build_signed_result(&loaded, &request, &private_key)?;
    let is_error = signed.result.status == "ERROR";
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::to_value(&signed).unwrap()).unwrap()
    );
    Ok(is_error)
}

/// `inspect-key`: prints the validatorId derived from a public key alone
/// -- no private key needed or read. Lets anyone confirm what validatorId
/// a given public key corresponds to (e.g. to cross-check a signed
/// result's `validatorPublicKey`/`validatorId` pair) without any signing
/// capability.
fn run_inspect_key(public_key_path: &Path) -> Result<(), String> {
    let text = fs::read_to_string(public_key_path).map_err(|e| {
        format!(
            "failed to read public key file {}: {e}",
            public_key_path.display()
        )
    })?;
    let public_key = text.trim().to_string();
    let validator_id = derive_validator_id(&public_key)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "signatureAlgorithm": "ed25519",
            "publicKey": public_key,
            "validatorId": validator_id,
        }))
        .unwrap()
    );
    Ok(())
}

/// `generate-golden-vectors`: (re)writes the committed golden protocol
/// vectors. Refuses to do anything unless `--confirm-update` is passed --
/// a plain safety gate against a script or a habit of muscle memory
/// silently overwriting a reviewed, committed artifact.
fn run_generate_golden_vectors(
    policy: &Path,
    input_path: &Path,
    out_dir: &Path,
    profile: &Option<PathBuf>,
    confirm_update: bool,
) -> Result<(), String> {
    if !confirm_update {
        return Err(
            "refusing to (re)generate golden vectors without --confirm-update -- \
             these are a committed, git-reviewed artifact, not a build output"
                .to_string(),
        );
    }
    let loaded = load_policy(policy, profile)?;
    let input_text =
        fs::read_to_string(input_path).map_err(|e| format!("failed to read input file: {e}"))?;
    let input: serde_json::Value =
        serde_json::from_str(&input_text).map_err(|e| format!("failed to parse input: {e}"))?;
    let set = build_golden_vector_set(&loaded, input)?;
    write_golden_vector_set(out_dir, &set)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "status": "GOLDEN_VECTORS_WRITTEN",
            "outDir": out_dir,
            "validatorId": set.validator_id,
            "executionHash": set.execution_hash,
        }))
        .unwrap()
    );
    Ok(())
}

fn run_replay_verify(
    policy: &Path,
    request_path: &Path,
    signed_result_path: &Path,
    profile: &Option<PathBuf>,
) -> Result<bool, String> {
    let loaded = load_policy(policy, profile)?;
    let request_text = fs::read_to_string(request_path)
        .map_err(|e| format!("failed to read request file: {e}"))?;
    let request = parse_execution_request(&request_text)?;
    let signed_text = fs::read_to_string(signed_result_path)
        .map_err(|e| format!("failed to read signed result file: {e}"))?;
    let signed = parse_signed_validator_result(&signed_text)?;

    let report = replay_verify(&loaded, &request, &signed);
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "status": if report.ok { "REPLAY_OK" } else { "REPLAY_FAILURE" },
            "checks": report.checks.iter().map(|c| serde_json::json!({
                "name": c.name,
                "passed": c.passed,
            })).collect::<Vec<_>>(),
        }))
        .unwrap()
    );
    Ok(!report.ok)
}

fn main() {
    let cli = Cli::parse();
    let outcome = match &cli.command {
        Command::Run {
            policy,
            input,
            profile,
        } => load_policy(policy, profile).and_then(|loaded| {
            let result = execute(&loaded, input)?;
            let is_error = result.is_error;
            print_result(&loaded, &result);
            Ok(is_error)
        }),
        Command::DeterminismCheck {
            policy,
            input,
            profile,
            runs,
        } => run_determinism_check(policy, input, profile, *runs).map(|()| false),
        Command::Keygen { private_key_out } => run_keygen(private_key_out).map(|()| false),
        Command::BuildRequest {
            policy,
            input,
            request_id,
            profile,
        } => run_build_request(policy, input, request_id, profile).map(|()| false),
        Command::Execute {
            policy,
            request,
            profile,
            private_key_file,
        } => run_execute(policy, request, profile, private_key_file),
        Command::ReplayVerify {
            policy,
            request,
            signed_result,
            profile,
        } => run_replay_verify(policy, request, signed_result, profile),
        Command::InspectKey { public_key } => run_inspect_key(public_key).map(|()| false),
        Command::GenerateGoldenVectors {
            policy,
            input,
            out_dir,
            profile,
            confirm_update,
        } => run_generate_golden_vectors(policy, input, out_dir, profile, *confirm_update)
            .map(|()| false),
    };

    match outcome {
        Ok(is_error) => {
            if is_error {
                std::process::exit(1);
            }
        }
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    }
}
