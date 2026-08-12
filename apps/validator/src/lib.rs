// SPDX-License-Identifier: Apache-2.0
//! Core logic for `ddn-validator`: load a DDN policy package (manifest +
//! `policy.wasm`), execute it against canonical JSON input under Wasmtime,
//! and compute the input/policy/profile/output/execution hashes. Split out
//! of `main.rs` so it can be exercised directly by integration tests (e.g.
//! comparing native `ddn-negotiation-v1::evaluate()` output against this
//! WASM execution path for every vector in
//! `packages/test-vectors/vectors/negotiation-v1.json`).
//! See `docs/execution-profile-v1.md`.

pub mod golden_vectors;
pub mod identity;
pub mod package;
pub mod protocol;

use ddn_canonical_json::{canonicalize_bytes, parse_and_canonicalize};
use ddn_crypto::{hash_canonical_json, sha256_bytes};
use package::PolicyPackageError;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use wasmtime::{Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

/// `#[serde(deny_unknown_fields)]`: an unrecognized field makes the whole
/// manifest -- and so the whole policy package -- untrustworthy, per
/// `docs/validator-result-v1.md`'s policy-package-pinning section.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    #[allow(dead_code)]
    pub manifest_version: String,
    pub policy_id: String,
    pub policy_version: String,
    #[allow(dead_code)]
    pub publisher_id: String,
    pub entrypoint: String,
    pub execution_profile_id: String,
    pub input_schema_hash: String,
    pub output_schema_hash: String,
    pub reason_code_registry_hash: String,
    pub wasm_hash: String,
    pub test_vector_hash: String,
    #[allow(dead_code)]
    pub created_at: String,
}

pub struct ExecutionResult {
    pub input_hash: String,
    pub policy_hash: String,
    pub profile_hash: String,
    pub output_hash: String,
    pub execution_hash: String,
    pub output_value: Value,
    pub is_error: bool,
}

/// A policy package with its Wasmtime `Engine`/`Module` compiled once, so
/// running it many times (e.g. `determinism-check --runs 1000`) doesn't
/// re-run Cranelift compilation on every iteration — only a fresh `Store`
/// and instantiation, which is cheap.
pub struct LoadedPolicy {
    pub manifest: Manifest,
    pub policy_hash: String,
    pub profile_hash: String,
    pub manifest_hash: String,
    fuel_limit: u64,
    max_memory_bytes: usize,
    max_input_bytes: usize,
    max_output_bytes: usize,
    timeout_ms: u64,
    engine: Engine,
    module: Module,
}

/// Cancels and joins the per-execution epoch timer on every return path.
/// Joining is essential for determinism-check: a timer from an already
/// completed run must never increment the shared engine epoch during the
/// next run.
struct EpochTimeoutGuard {
    state: Arc<(Mutex<bool>, Condvar)>,
    handle: Option<JoinHandle<()>>,
}

impl EpochTimeoutGuard {
    fn arm(engine: &Engine, timeout_ms: u64) -> Self {
        let state = Arc::new((Mutex::new(false), Condvar::new()));
        let timer_state = Arc::clone(&state);
        let timer_engine = engine.clone();
        let handle = thread::spawn(move || {
            let (lock, condition) = &*timer_state;
            let cancelled = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let (cancelled, wait) = condition
                .wait_timeout_while(cancelled, Duration::from_millis(timeout_ms), |value| {
                    !*value
                })
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !*cancelled && wait.timed_out() {
                timer_engine.increment_epoch();
            }
        });
        Self {
            state,
            handle: Some(handle),
        }
    }
}

impl Drop for EpochTimeoutGuard {
    fn drop(&mut self) {
        let (lock, condition) = &*self.state;
        let mut cancelled = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *cancelled = true;
        condition.notify_one();
        drop(cancelled);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

pub fn default_profiles_dir() -> PathBuf {
    // This binary lives inside the ddn monorepo; profile configs are
    // checked in under packages/config/profiles. CARGO_MANIFEST_DIR is
    // baked in at compile time and is only meaningful for developers
    // running this CLI from within a checkout of this repo, which is the
    // only supported way to run it in Milestone 1-2.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/config/profiles")
}

/// Parses `manifest.json` and computes its canonical hash (excluding
/// `createdAt`, which is expected to vary between otherwise-identical
/// builds -- see `docs/reproducible-builds.md`) in one pass, so both stay
/// derived from the exact same bytes on disk.
fn load_manifest(policy_dir: &Path) -> Result<(Manifest, String), PolicyPackageError> {
    let path = policy_dir.join("manifest.json");
    let text = fs::read_to_string(&path).map_err(|e| {
        PolicyPackageError::PolicyPackageInvalid(format!("failed to read manifest.json: {e}"))
    })?;
    let manifest: Manifest = serde_json::from_str(&text).map_err(|e| {
        PolicyPackageError::PolicyPackageInvalid(format!("failed to parse manifest.json: {e}"))
    })?;

    let mut manifest_value: Value = serde_json::from_str(&text).map_err(|e| {
        PolicyPackageError::PolicyPackageInvalid(format!("failed to parse manifest.json: {e}"))
    })?;
    if let Some(obj) = manifest_value.as_object_mut() {
        obj.remove("createdAt");
    }
    let manifest_hash = hash_canonical_json("DDN_POLICY_MANIFEST_V1", &manifest_value)
        .map_err(|e| PolicyPackageError::PolicyPackageInvalid(e.to_string()))?;

    Ok((manifest, manifest_hash))
}

fn load_profile(
    execution_profile_id: &str,
    profile_override: &Option<PathBuf>,
) -> Result<Value, String> {
    let path = match profile_override {
        Some(p) => p.clone(),
        None => default_profiles_dir().join(format!("{execution_profile_id}.json")),
    };
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read execution profile {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("failed to parse execution profile: {e}"))
}

pub fn load_policy(
    policy_dir: &Path,
    profile_override: &Option<PathBuf>,
) -> Result<LoadedPolicy, String> {
    let (manifest, manifest_hash) = load_manifest(policy_dir)?;

    // Policy package pinning (Milestone 3 hardening): every hash the
    // manifest declares is recomputed from the actual file on disk here,
    // never taken on the manifest's (or a caller's) word alone. See
    // apps/validator/src/package.rs and docs/validator-result-v1.md.
    let wasm_path = policy_dir.join("policy.wasm");
    let wasm_bytes = fs::read(&wasm_path).map_err(|e| {
        PolicyPackageError::PolicyPackageInvalid(format!("failed to read policy.wasm: {e}"))
    })?;
    let policy_hash = sha256_bytes(&wasm_bytes);
    package::verify_policy_hash(&manifest.wasm_hash, &policy_hash)?;

    let input_schema_hash = package::sha256_file(&policy_dir.join("input.schema.json"))?;
    package::verify_schema_hash(
        "inputSchemaHash",
        &manifest.input_schema_hash,
        &input_schema_hash,
    )?;
    let output_schema_hash = package::sha256_file(&policy_dir.join("output.schema.json"))?;
    package::verify_schema_hash(
        "outputSchemaHash",
        &manifest.output_schema_hash,
        &output_schema_hash,
    )?;
    let reason_code_registry_hash = package::sha256_file(&policy_dir.join("reason-codes.json"))?;
    package::verify_schema_hash(
        "reasonCodeRegistryHash",
        &manifest.reason_code_registry_hash,
        &reason_code_registry_hash,
    )?;
    let test_vector_hash = package::sha256_file(&policy_dir.join("test-vectors.json"))?;
    package::verify_schema_hash(
        "testVectorHash",
        &manifest.test_vector_hash,
        &test_vector_hash,
    )?;

    let profile_value = load_profile(&manifest.execution_profile_id, profile_override)?;
    let profile_hash =
        hash_canonical_json("DDN_PROFILE_V1", &profile_value).map_err(|e| e.to_string())?;

    let fuel_limit = profile_value["fuelLimit"]
        .as_u64()
        .ok_or("execution profile missing integer fuelLimit")?;
    let max_memory_bytes = usize::try_from(
        profile_value["maxMemoryBytes"]
            .as_u64()
            .ok_or("execution profile missing integer maxMemoryBytes")?,
    )
    .map_err(|_| "execution profile maxMemoryBytes does not fit this platform")?;
    let max_input_bytes = profile_value["maxInputBytes"]
        .as_u64()
        .ok_or("execution profile missing integer maxInputBytes")?
        as usize;
    let max_output_bytes = profile_value["maxOutputBytes"]
        .as_u64()
        .ok_or("execution profile missing integer maxOutputBytes")?
        as usize;
    let timeout_ms = profile_value["timeoutMs"]
        .as_u64()
        .filter(|value| *value > 0)
        .ok_or("execution profile missing positive integer timeoutMs")?;
    let wasi_enabled = profile_value["wasiEnabled"]
        .as_bool()
        .ok_or("execution profile missing boolean wasiEnabled")?;
    if wasi_enabled {
        return Err("this runner does not support wasiEnabled: true".to_string());
    }

    let mut config = Config::new();
    config.consume_fuel(true);
    config.epoch_interruption(true);
    let engine =
        Engine::new(&config).map_err(|e| format!("failed to create wasmtime engine: {e}"))?;
    let module = Module::from_binary(&engine, &wasm_bytes)
        .map_err(|e| format!("failed to load policy.wasm: {e}"))?;

    Ok(LoadedPolicy {
        manifest,
        policy_hash,
        profile_hash,
        manifest_hash,
        fuel_limit,
        max_memory_bytes,
        max_input_bytes,
        max_output_bytes,
        timeout_ms,
        engine,
        module,
    })
}

pub fn execute(loaded: &LoadedPolicy, input_path: &Path) -> Result<ExecutionResult, String> {
    let input_text =
        fs::read_to_string(input_path).map_err(|e| format!("failed to read input file: {e}"))?;
    execute_text(loaded, &input_text)
}

/// Same as [`execute`] but takes the input JSON text directly, so tests can
/// feed vectors without writing a temp file per case.
pub fn execute_text(loaded: &LoadedPolicy, input_text: &str) -> Result<ExecutionResult, String> {
    let (input_value, canonical_input) = parse_and_canonicalize(input_text)
        .map_err(|e| format!("input is not valid canonical JSON: {e}"))?;
    let canonical_input_bytes = canonical_input.into_bytes();
    if canonical_input_bytes.len() > loaded.max_input_bytes {
        return Err(format!(
            "canonical input is {} bytes, exceeding maxInputBytes {}",
            canonical_input_bytes.len(),
            loaded.max_input_bytes
        ));
    }
    let input_hash =
        hash_canonical_json("DDN_INPUT_V1", &input_value).map_err(|e| e.to_string())?;

    let limits = StoreLimitsBuilder::new()
        .memory_size(loaded.max_memory_bytes)
        .instances(1)
        .memories(1)
        .trap_on_grow_failure(true)
        .build();
    let linker: Linker<StoreLimits> = Linker::new(&loaded.engine);
    let mut store = Store::new(&loaded.engine, limits);
    store.limiter(|limits| limits);
    store
        .set_fuel(loaded.fuel_limit)
        .map_err(|e| format!("failed to set fuel limit: {e}"))?;
    store.set_epoch_deadline(1);
    let _timeout_guard = EpochTimeoutGuard::arm(&loaded.engine, loaded.timeout_ms);

    let instance = linker
        .instantiate(&mut store, &loaded.module)
        .map_err(|e| format!("failed to instantiate policy.wasm: {e}"))?;

    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or("policy.wasm does not export linear memory named 'memory'")?;
    let alloc_fn = instance
        .get_typed_func::<u32, u32>(&mut store, "ddn_alloc")
        .map_err(|e| format!("policy.wasm does not export ddn_alloc: {e}"))?;
    let evaluate_fn = instance
        .get_typed_func::<(u32, u32), u64>(&mut store, &loaded.manifest.entrypoint)
        .map_err(|e| {
            format!(
                "policy.wasm does not export entrypoint '{}': {e}",
                loaded.manifest.entrypoint
            )
        })?;

    let input_ptr = alloc_fn
        .call(&mut store, canonical_input_bytes.len() as u32)
        .map_err(|e| format!("ddn_alloc trapped: {e}"))?;
    memory
        .write(&mut store, input_ptr as usize, &canonical_input_bytes)
        .map_err(|e| format!("failed to write input into wasm memory: {e}"))?;

    let packed = evaluate_fn
        .call(&mut store, (input_ptr, canonical_input_bytes.len() as u32))
        .map_err(|e| {
            format!("policy execution trapped (fuel, memory, deadline, or policy failure): {e}")
        })?;
    let out_ptr = (packed >> 32) as u32;
    let out_len = (packed & 0xFFFF_FFFF) as u32;

    if out_len as usize > loaded.max_output_bytes {
        return Err(format!(
            "wasm output is {out_len} bytes, exceeding maxOutputBytes {}",
            loaded.max_output_bytes
        ));
    }

    let mut out_buf = vec![0u8; out_len as usize];
    memory
        .read(&store, out_ptr as usize, &mut out_buf)
        .map_err(|e| format!("failed to read output from wasm memory: {e}"))?;
    let output_text =
        String::from_utf8(out_buf).map_err(|e| format!("wasm output is not valid UTF-8: {e}"))?;

    // Re-canonicalize the runner's own copy of the output rather than
    // trusting the wasm side blindly: this is the runner's own integrity
    // check on top of whatever the policy already did internally.
    let (output_value, _canonical_output) = parse_and_canonicalize(&output_text)
        .map_err(|e| format!("wasm output is not valid canonical JSON: {e}"))?;
    let is_error = output_value.get("error").is_some();

    let output_hash =
        hash_canonical_json("DDN_OUTPUT_V1", &output_value).map_err(|e| e.to_string())?;

    let execution_envelope = serde_json::json!({
        "domain": "DDN_EXECUTION_V1",
        "inputHash": input_hash,
        "policyHash": loaded.policy_hash,
        "profileHash": loaded.profile_hash,
        "outputHash": output_hash,
    });
    let execution_hash =
        sha256_bytes(&canonicalize_bytes(&execution_envelope).map_err(|e| e.to_string())?);

    Ok(ExecutionResult {
        input_hash,
        policy_hash: loaded.policy_hash.clone(),
        profile_hash: loaded.profile_hash.clone(),
        output_hash,
        execution_hash,
        output_value,
        is_error,
    })
}

#[cfg(test)]
mod resource_limit_tests {
    use super::*;
    use std::time::Instant;
    use wasm_encoder::{
        BlockType, CodeSection, ExportKind, ExportSection, Function, FunctionSection, Instruction,
        MemorySection, MemoryType, Module as EncodedModule, TypeSection, ValType,
    };

    fn test_manifest() -> Manifest {
        Manifest {
            manifest_version: "1.0.0".to_string(),
            policy_id: "test-only-resource-policy".to_string(),
            policy_version: "1.0.0".to_string(),
            publisher_id: "test-only".to_string(),
            entrypoint: "evaluate".to_string(),
            execution_profile_id: "test-only".to_string(),
            input_schema_hash: "test-only".to_string(),
            output_schema_hash: "test-only".to_string(),
            reason_code_registry_hash: "test-only".to_string(),
            wasm_hash: "test-only".to_string(),
            test_vector_hash: "test-only".to_string(),
            created_at: "1970-01-01T00:00:00Z".to_string(),
        }
    }

    fn module_with_evaluate(body: &[Instruction<'_>]) -> Vec<u8> {
        let mut module = EncodedModule::new();
        let mut types = TypeSection::new();
        types.ty().function([ValType::I32], [ValType::I32]);
        types
            .ty()
            .function([ValType::I32, ValType::I32], [ValType::I64]);
        module.section(&types);

        let mut functions = FunctionSection::new();
        functions.function(0);
        functions.function(1);
        module.section(&functions);

        let mut memories = MemorySection::new();
        memories.memory(MemoryType {
            minimum: 1,
            maximum: None,
            memory64: false,
            shared: false,
            page_size_log2: None,
        });
        module.section(&memories);

        let mut exports = ExportSection::new();
        exports.export("memory", ExportKind::Memory, 0);
        exports.export("ddn_alloc", ExportKind::Func, 0);
        exports.export("evaluate", ExportKind::Func, 1);
        module.section(&exports);

        let mut code = CodeSection::new();
        let mut alloc = Function::new([]);
        alloc.instruction(&Instruction::I32Const(0));
        alloc.instruction(&Instruction::End);
        code.function(&alloc);
        let mut evaluate = Function::new([]);
        for instruction in body {
            evaluate.instruction(instruction);
        }
        evaluate.instruction(&Instruction::End);
        code.function(&evaluate);
        module.section(&code);
        module.finish()
    }

    fn loaded_for(
        wasm: &[u8],
        max_memory_bytes: usize,
        timeout_ms: u64,
        fuel_limit: u64,
    ) -> LoadedPolicy {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.epoch_interruption(true);
        let engine = Engine::new(&config).expect("test engine");
        let module = Module::from_binary(&engine, wasm).expect("test module");
        LoadedPolicy {
            manifest: test_manifest(),
            policy_hash: "test-only".to_string(),
            profile_hash: "test-only".to_string(),
            manifest_hash: "test-only".to_string(),
            fuel_limit,
            max_memory_bytes,
            max_input_bytes: 4096,
            max_output_bytes: 4096,
            timeout_ms,
            engine,
            module,
        }
    }

    #[test]
    fn memory_growth_beyond_profile_limit_fails_closed() {
        let wasm = module_with_evaluate(&[
            Instruction::I32Const(2),
            Instruction::MemoryGrow(0),
            Instruction::Drop,
            Instruction::I64Const(0),
        ]);
        let loaded = loaded_for(&wasm, 65_536, 1_000, 1_000_000);
        let error = match execute_text(&loaded, r#"{"value":"public-test-input"}"#) {
            Ok(_) => panic!("memory growth beyond maxMemoryBytes must fail"),
            Err(error) => error,
        };
        assert!(
            error.contains("trapped"),
            "unexpected error category: {error}"
        );
    }

    #[test]
    fn infinite_wasm_is_interrupted_without_echoing_input() {
        let wasm = module_with_evaluate(&[
            Instruction::Loop(BlockType::Empty),
            Instruction::Br(0),
            Instruction::End,
            Instruction::I64Const(0),
        ]);
        let loaded = loaded_for(&wasm, 65_536, 25, u64::MAX);
        let sensitive_marker = "must-not-appear-in-resource-error";
        let input = format!(r#"{{"value":"{sensitive_marker}"}}"#);
        let started = Instant::now();
        let error = match execute_text(&loaded, &input) {
            Ok(_) => panic!("infinite wasm must hit timeoutMs"),
            Err(error) => error,
        };
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(
            error.contains("trapped"),
            "unexpected error category: {error}"
        );
        assert!(
            !error.contains(sensitive_marker),
            "resource error leaked input content"
        );
    }
}
