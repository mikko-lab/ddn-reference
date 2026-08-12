# Milestone 2 verification

Filled in with actual results from this implementation, not written in
advance. Base commit (Milestone 0, before this work started):
`8c2e4f86884dbb5b656b1c08da3657a9fc659f11`. See `git log` for the commits
that implement Milestone 1-2 on top of it.

**`ddn-m2-reproducibility-v1` has been superseded by
`ddn-m2-reproducibility-v1.1`**, which explicitly limits the release
reproducibility guarantee to `linux/arm64` and corrects an earlier wrong
conclusion about the amd64/QEMU relationship. `v1` is left as-is (an
immutable reference to a specific state, not moved after the fact); `v1.1`
is the current, accurate record.

## Versions used

| Tool | Version |
| --- | --- |
| Node.js | v22.22.2 |
| pnpm | 10.33.0 |
| rustc | 1.94.1 (e408947bf 2026-03-25) |
| cargo | 1.94.1 (29ea6fb6a 2026-03-24) |
| Wasmtime (crate) | 27.0.0 (pinned via `wasmtime = "27"` in the workspace `Cargo.toml`; exact resolution recorded in `Cargo.lock`) |
| Rust edition | 2024 |
| Rust target | `wasm32-unknown-unknown` |

## Test counts

| Crate/package | Tests | What they cover |
| --- | --- | --- |
| `ddn-canonical-json` (Rust) | 7 unit + 2 cross-language | Cross-language tests load all 33 valid + 17 invalid shared vectors |
| `@ddn/canonical-json` (TS) | 51 | Same shared vector file, one test per vector plus a count assertion |
| `ddn-crypto` (Rust) | 6 unit + 6 cross-language | Cross-language tests cover sign/verify round-trip, tamper detection ×2, wrong-key rejection, 3 SHA-256 vectors |
| `@ddn/crypto` (TS) | 8 | Same shared crypto vector file |
| `@ddn/schemas` (TS) | 12 | Schema validation + cross-field invariants for both input and output |
| `ddn-negotiation-v1` | 10 unit + 9 property-based (proptest, 256 cases each by default) + 2 vector-file tests | Rule table, priority ordering, all 24 shared negotiation vectors |
| `ddn-validator` | 1 integration test | All 24 negotiation vectors executed through the actual WASM module and compared against native `evaluate()`'s recorded output/hashes |

Shared vector counts: 33 valid + 17 invalid canonical-JSON vectors, 1
Ed25519 keypair/message/signature vector + 3 SHA-256 vectors, 24 negotiation
vectors (spanning all 4 decisions, both offer-round boundaries, exact-floor/
exact-list boundaries, 3 defense-in-depth cases, 2 large-safe-integer
boundary cases).

## 1000-run determinism result

```
$ ./target/release/ddn-validator determinism-check \
    --policy policies/negotiation-v1/package \
    --input packages/test-vectors/fixtures/negotiation-counter.json \
    --runs 1000

{
  "status": "DETERMINISM_OK",
  "totalRuns": 1000,
  "outputHash": "sha256:46c563ca501d1743b2cec8c3f244890976ddc25b929cdfb2ebf470ce4ceb5010",
  "executionHash": "sha256:e721a21ea88581d11c83469e6f85b1b89523968ae20372784ec7971b69bb9302"
}
```

(`executionHash` is a function of `policyHash`, which is the hash of a
specific `policy.wasm` build — it changes whenever the wasm bytes change,
including from source-formatting-only edits that shift embedded panic
line-number metadata. `outputHash` is the value that reflects the decision
logic itself and is the one that matters for cross-language/native-vs-WASM
identity checks above. Rebuilding from identical source on this machine was
separately confirmed to reproduce the same `policy.wasm` hash twice in a
row.)

Wall-clock time: ~0.3s for all 1000 runs (Engine/Module compiled once,
reused across runs — see `docs/execution-profile-v1.md`). This `outputHash`
is identical to the `counter-one-cent-below-floor` vector's recorded
`outputHash` in `packages/test-vectors/vectors/negotiation-v1.json`,
confirming native Rust `evaluate()` and this WASM execution agree, in
addition to the dedicated `ddn-validator` integration test that checks this
for all 24 vectors.

## Builder A / builder B hash (reproducible build)

**Available — executed end-to-end, not just CI-wired.** Run locally via
`./scripts/policy-reproducibility.sh` against implementation commit
`1c50ec68d6be0ef719423398a56eb929413a2ff8` ("feat: prove reproducible DDN
policy builds" — the Dockerfiles, `scripts/policy-reproducibility.sh`, the
architecture lock, and the execution-profile toolchain block all landed in
that commit; this document is a separate, later commit recording its
results, so it can cite that commit's final SHA rather than referencing
itself):

```
== Building builder A (Debian/glibc userland) ==
...
== Building builder B (Alpine/musl userland) ==
...
builder A (Debian/glibc userland): 62bb7ca911c6257ec4bea116090b8d0c8607e7d2bbbbf430805f58270c68280a
builder B (Alpine/musl userland):  62bb7ca911c6257ec4bea116090b8d0c8607e7d2bbbbf430805f58270c68280a
cmp: bit-for-bit identical
REPRODUCIBLE: both builders produced sha256:62bb7ca911c6257ec4bea116090b8d0c8607e7d2bbbbf430805f58270c68280a
```

Toolchain identity (identical on both builders):

```
rustc 1.94.1 (e408947bf 2026-03-25)
commit-hash: e408947bfd200af42db322daf0fadfe7e26d3bd1
host: aarch64-unknown-linux-musl
cargo 1.94.1 (29ea6fb6a 2026-03-24)
```

`wasmHash` in the current `manifest.json`:
`sha256:62bb7ca911c6257ec4bea116090b8d0c8607e7d2bbbbf430805f58270c68280a`
(supersedes the earlier single-build-only hash recorded in prior revisions
of this document, from before the two-builder comparison was executed).

Full design rationale, the two real bugs diagnosed and fixed to get here
(a Cargo per-crate metadata hash that folded in the compiler's own host
identity; musl's dynamic-loader and `musl-gcc`'s link-time search paths),
and why `LD_LIBRARY_PATH` was deliberately not used as the fix, are in
`docs/reproducible-builds.md` — not repeated here. Negative-test proof that
the comparison actually rejects a mismatch (wrong pinned image digest,
tampered `Cargo.lock` checksum, corrupted target-rustlib, a single flipped
`policy.wasm` byte, a different build flag) is in
`./scripts/policy-reproducibility-negative-tests.sh` (5/5 passing).

**Verified on arm64 (Apple Silicon, local dev machine and GitHub Actions'
`ubuntu-24.04-arm` hosted runner); amd64 is not yet proven and is not part
of this guarantee.** The release architecture is locked to arm64
(`toolchain.releaseBuildArchitecture` in
`packages/config/profiles/ddn-wasm-v1.json`). Native amd64 (both a
GitHub-hosted `ubuntu-latest` runner and local QEMU emulation) currently
fails nondeterministically with `SIGSEGV` in host build-script binaries
after starting up correctly — the toolchain itself, and its musl runtime
dependency resolution, are confirmed working on amd64; a full `cargo
build` is not yet reliable there. This is tracked as a non-blocking,
experimental CI job (`cross-architecture-amd64` in
`.github/workflows/ci.yml`) and a separate investigation issue
(the separately tracked amd64 investigation), not
silently absorbed into the release gate. Full detail:
`docs/reproducible-builds.md#native-linuxamd64-cross-architecture-validation-experimental`.

(An earlier revision of this document attributed the amd64 failure to
QEMU emulation specifically. That was incorrect — the identical crash
reproduces on native amd64 hardware — and is corrected here and in
`docs/reproducible-builds.md`.)

Commands executed for the above:

```bash
./scripts/policy-reproducibility.sh
./scripts/policy-reproducibility-negative-tests.sh
```

## Known limitations

- `apps/validator` enforces `maxMemoryBytes` with Wasmtime store limits and
  `timeoutMs` with Wasmtime epoch interruption, in addition to fuel and
  input/output byte limits; see `docs/execution-profile-v1.md`.
- The reproducible-build Docker images are pinned by digest now (both
  builder base images and the shared compiler-source image — see
  `docs/reproducible-builds.md`), superseding the earlier tag-only pinning.
- Reproducibility is proven **within** one architecture, not across
  architectures. arm64 (the locked release architecture) is proven; amd64
  is not yet, and currently fails nondeterministically in CI's
  non-blocking `cross-architecture-amd64` job (tracked in a separate
  investigation issue: the separately tracked amd64 investigation) — see
  `docs/reproducible-builds.md#native-linuxamd64-cross-architecture-validation-experimental`.
  This is a named scope boundary, not a hidden gap: "Reproducibility is
  guaranteed for the defined pinned build profile. It is not claimed across
  different Rust compiler artifacts or toolchain identities."
- `policyEffectiveAt` is carried through the schema and policy input but not
  evaluated; no `POLICY_NOT_EFFECTIVE` decision path exists yet (documented
  as an explicit scope decision in `docs/negotiation-policy-v1.md`, matching
  the build plan's "if implemented in this version" phrasing).
- `apps/validator`'s `ddn_dealloc` WASM export is unused by the current
  runner (each invocation tears down its module after use); a long-running
  validator service (Milestone 3) will need to actually call it or manage
  memory per-call.

## What is proven

Per the acceptance criteria recorded in this document: canonical JSON
(cross-language, 30+ vectors), SHA-256 and Ed25519 (cross-language,
including a byte-identical deterministic signature from the same seed),
negotiation schemas (JSON Schema + runtime validation, closed reason-code
registry), the negotiation-v1 policy (pure Rust, property-tested, 20+
vectors), WASM compilation with a documented ABI, native-vs-WASM identity,
1000-run determinism, and the reproducible-build criterion (two independent
clean builders, bit-for-bit identical `policy.wasm`, verified on arm64 with
5/5 negative tests proving the check itself has teeth — see above) are all
verified in this repository, in this sandbox. Not "almost," not
"semantically the same" — proven with `sha256sum` and `cmp`.
