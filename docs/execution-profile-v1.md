# Execution profile v1 (`ddn-wasm-v1`)

`packages/config/profiles/ddn-wasm-v1.json` pins the runtime configuration
that a policy is executed under. Any change to it changes `profileHash`,
which is one of the four inputs to `executionHash` — so a policy run under
a different fuel limit, memory cap, or Wasmtime version is a provably
different execution, not silently comparable to one run under this profile.

```json
{
  "profileId": "ddn-wasm-v1",
  "runtime": "wasmtime",
  "wasmtimeVersion": "27.0.0",
  "wasmProposalSet": ["mvp", "bulk-memory"],
  "wasiEnabled": false,
  "nanCanonicalization": true,
  "fuelLimit": 10000000,
  "maxMemoryBytes": 67108864,
  "maxInputBytes": 262144,
  "maxOutputBytes": 262144,
  "timeoutMs": 2000,
  "canonicalJson": "RFC8785-DDN-INTEGER-PROFILE-V1",
  "hashAlgorithm": "sha256",
  "signatureAlgorithm": "ed25519",
  "toolchain": {
    "arch": "aarch64",
    "releaseBuildArchitecture": "linux/arm64",
    "rustcVersion": "1.94.1",
    "rustcCommitHash": "e408947bfd200af42db322daf0fadfe7e26d3bd1",
    "rustcHost": "aarch64-unknown-linux-musl",
    "rustcBinarySha256": "015d0b6bcd8447fd8efb61609b2c76807b4774b76d61d2fdba0928dd8389a4e7",
    "cargoBinarySha256": "23595e6f2369f94f01f56d12974490f03aa68c3dc4095c15625f3ba175b309d9",
    "targetRustlibSha256": "e10e6e257288621cb76c08fd3d48f027f780ee38f92b4ef063ff564b759f7912",
    "muslLoaderSha256": "97ff04100dc87fa4f6486bb02794404a43026608cf256f56dd0bbb81ecf55a6e",
    "libgccSSha256": "c8ae3477f1f9e16af032fe3a34764541b55ddb5abc83c4a50c7f18b3fdd4eb35",
    "builderImageDigests": {
      "toolchainSource": "rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35",
      "builderA": "debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818",
      "builderB": "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
    },
    "buildConfigurationSha256": "572e3fc3dbee62e3981f390cc0cd038094826ccc0af9a52a30a1d38c42175718"
  }
}
```

`wasmtimeVersion` is pinned to the exact resolved version in `Cargo.lock`
(`wasmtime = "27"` in the workspace `Cargo.toml` resolves to `27.0.0`).
Bump both together.

## The `toolchain` block

Binds `profileHash` not just to *how the policy is run* (the fields above)
but to *what toolchain produced the exact `policy.wasm` this profile ships
alongside* — see `docs/reproducible-builds.md` for the full story behind
each field. Confirmed directly, not assumed: removing this block changes
`profileHash` from `sha256:f86723155864ef0ac7d75ca4958d2d36bbbf04e48938a70a516f993a3fe3a178`
to `sha256:bfe5db2b70d2ce581fbd632a1a4292af56a6b0ff6180d56413e374069c9ff8bb`
— so a decision receipt genuinely commits to this exact toolchain identity,
not only to the runtime config above it.

`scripts/policy-reproducibility.sh` regenerates this block automatically
after every successful reproducible build (via
`scripts/update-execution-profile-toolchain.mjs`) rather than it being a
hand-maintained constant — a build that used a different pinned digest but
the *same* `releaseBuildArchitecture` writes its own matching `toolchain`
block, so this file can't silently drift out of sync with the artifact it
describes.

**A build on a *different* architecture does not overwrite this file.**
`releaseBuildArchitecture` locks the release profile to the one
architecture whose build actually produced the currently-committed
`policy.wasm`. Reproducibility holds within an architecture, not across
architectures (`docs/reproducible-builds.md#reproducibility-is-per-architecture`)
— so a run on a different architecture is a real result (proof that *that*
architecture is also internally reproducible) but not a release action.
`scripts/policy-reproducibility.sh` detects the mismatch, prints a
"CROSS-ARCHITECTURE VALIDATION PASSED" result, and exits without touching
`policy.wasm`, `manifest.json`, or this profile.
`scripts/update-execution-profile-toolchain.mjs` refuses the same way if
invoked directly, rather than trusting its caller to have already checked.
Changing the release architecture on purpose (e.g. adopting amd64 as the
shipped target) is a deliberate action: delete or edit
`toolchain.releaseBuildArchitecture` in this file first, then re-run the
reproducibility script on the new target architecture to re-establish the
lock.

- `arch` / `rustcVersion` / `rustcCommitHash` / `rustcHost` — the compiler
  identity from `rustc -vV`, straight from builder A (whichever builder's
  `policy.wasm` gets copied into the package; both builders were just
  proven byte-identical on this architecture, so either reflects the same
  build).
- `releaseBuildArchitecture` — the Docker platform string (`linux/arm64`,
  `linux/amd64`, ...) this release is locked to; see above.
- `rustcBinarySha256` / `cargoBinarySha256` / `muslLoaderSha256` /
  `libgccSSha256` — SHA-256 of the actual compiler-adjacent binaries used,
  all traced to the one pinned toolchain image digest below (see
  `docs/reproducible-builds.md` for why these come from one source, not
  independently from each builder's own OS packages).
- `targetRustlibSha256` — aggregate hash of every file in the
  `wasm32-unknown-unknown` rust-std component. **Architecture-specific**:
  verified by testing that this genuinely differs between an amd64 and an
  arm64 pull of the identical pinned image (see
  `docs/reproducible-builds.md#reproducibility-is-per-architecture`) — so
  this profile's `toolchain` block describes one specific architecture's
  build, and a different architecture's reproducibility run produces its
  own internally-consistent (but different) block, not a mismatch to
  reconcile.
- `builderImageDigests` — the three pinned image digests
  (`docker build`/`FROM`/`COPY --from=` sources) `scripts/policy-reproducibility.sh`
  asserts against before building anything.
- `buildConfigurationSha256` — hash of the canonical build configuration
  string (target triple, profile, `--locked`, `CARGO_INCREMENTAL`, package
  name) both builders are built with; see
  `scripts/policy-reproducibility.sh` for the exact string hashed.

## Enforcement status

`apps/validator` (`ddn-validator`) enforces:

- `wasiEnabled: false` — the runner refuses to run a profile with WASI
  enabled at all (and no WASI imports are linked in any case).
- `fuelLimit` — set via Wasmtime's fuel metering (`Config::consume_fuel`,
  `Store::set_fuel`); a policy that runs out of fuel traps deterministically
  rather than looping forever.
- `maxInputBytes` / `maxOutputBytes` — checked against the actual canonical
  JSON byte length before/after execution.
- `maxMemoryBytes` — applied to every fresh Wasmtime `Store` with
  `StoreLimits`; initial allocation or `memory.grow` beyond the profile
  limit traps and cannot produce an attestation.
- `timeoutMs` — each execution receives a one-epoch deadline and a joined
  per-run timer. Wasmtime epoch interruption traps execution after the
  wall-clock deadline. The timer is cancelled and joined on every return
  path so a completed determinism-check run cannot interrupt a later run.

Fuel remains the deterministic instruction-work bound. `timeoutMs` is a
host availability/resource-safety bound and its exact interruption point is
not a deterministic output. In either case a trap is fail-closed and never
counts toward quorum.

## WASM ABI

The policy is compiled for `wasm32-unknown-unknown` (`crate-type =
["cdylib", "rlib"]` in `policies/negotiation-v1/Cargo.toml`) — no WASI, no
`wasm-bindgen`, no component model. A minimal byte-in/byte-out ABI:

```rust
extern "C" fn ddn_alloc(len: usize) -> *mut u8;
extern "C" fn ddn_dealloc(ptr: *mut u8, len: usize);
extern "C" fn ddn_evaluate(ptr: *mut u8, len: usize) -> u64;
```

- The host calls `ddn_alloc(len)` to get a buffer inside the module's
  linear memory, writes the UTF-8 canonical JSON `NegotiationInputV1` into
  it, then calls `ddn_evaluate(ptr, len)`.
- `ddn_evaluate` returns a packed `u64`: `(output_ptr << 32) | output_len`,
  pointing at a **new** buffer (allocated internally via `ddn_alloc`) holding
  UTF-8 canonical JSON — either a `NegotiationOutputV1` or, on any internal
  error, `{"error": {"code": "...", "message": "..."}}`.
- `ddn_evaluate` never panics or traps on a policy-level error (bad input
  shape, unsupported `schemaVersion`): errors are caught inside the module
  and returned as the JSON error envelope above, so a malformed input
  produces a deterministic, inspectable failure rather than an opaque
  Wasmtime trap. A trap can still happen from resource exhaustion (fuel) or
  a genuine host/module contract violation (e.g. an out-of-bounds
  `ddn_alloc` request) — those are runner-level failures, not policy-logic
  failures.
- `ddn_dealloc` is exported for hygiene but unused by the current runner:
  each CLI invocation instantiates a fresh module and tears it down after
  one (or, for `determinism-check`, many sequential) execution(s), so
  per-call leaks inside one instantiation don't accumulate across process
  runs.

This ABI choice (over `wasm-bindgen` or the component model) was made for
simplicity and full determinism control: no generated glue code, no hidden
allocations, and the exact same UTF-8 canonical JSON bytes on both sides of
the boundary.

## Runner CLI (`ddn-validator`)

See `docs/negotiation-policy-v1.md` for what it computes.
`apps/validator/src/lib.rs` compiles the Wasmtime `Engine`/`Module` once per
`load_policy()` call and reuses it across repeated `execute()` calls — this
is what makes `determinism-check --runs 1000` take ~0.3s instead of
recompiling the module 1000 times.
