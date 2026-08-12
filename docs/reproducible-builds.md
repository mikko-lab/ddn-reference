# Reproducible policy builds

`scripts/policy-reproducibility.sh` builds `policies/negotiation-v1` to
`wasm32-unknown-unknown` inside two independent, clean Docker environments —
`infra/docker/policy-builder-a.Dockerfile` (Debian/glibc userland) and
`-b.Dockerfile` (Alpine/musl userland) — and fails unless both produce a
byte-identical `policy.wasm`.

## Acceptance statement

> Two independent clean build environments, Debian/glibc userland and
> Alpine/musl userland, produced a bit-for-bit identical `policy.wasm` using
> the same digest-pinned musl Rust toolchain, target libraries and build
> configuration.

Proven, not assumed — see [Verified result](#verified-result) below for the
actual hashes and the commands that produced them.

**Scope of the guarantee:**

> Reproducibility is guaranteed for the defined pinned build profile. It is
> not claimed across different Rust compiler artifacts or toolchain
> identities.

That second sentence is load-bearing, not throat-clearing — see
[Why the compiler artifact itself is pinned, not just its version](#why-the-compiler-artifact-itself-is-pinned-not-just-its-version)
for the concrete failure that made the distinction necessary.

**The release reproducibility guarantee currently applies to the pinned
`linux/arm64` build profile** (`toolchain.releaseBuildArchitecture` in
`packages/config/profiles/ddn-wasm-v1.json` — see
[Reproducibility is per-architecture](#reproducibility-is-per-architecture)
and [the amd64 status](#native-linuxamd64-cross-architecture-validation-experimental)
below for why amd64 is not part of this guarantee yet).

## Verified result

```
Builder A (Debian bookworm-slim userland): sha256:62bb7ca911c6257ec4bea116090b8d0c8607e7d2bbbbf430805f58270c68280a
Builder B (Alpine 3.20 userland):          sha256:62bb7ca911c6257ec4bea116090b8d0c8607e7d2bbbbf430805f58270c68280a
cmp (byte-for-byte): IDENTICAL
```

Both `rustc -vV` report identically:

```
rustc 1.94.1 (e408947bf 2026-03-25)
commit-hash: e408947bfd200af42db322daf0fadfe7e26d3bd1
host: aarch64-unknown-linux-musl
LLVM version: 21.1.8
```

Source commit: `30f52562ed9213d035d5f7bc29586e3b9f072fe0`. Reproduced on
arm64 (Apple Silicon, local dev machine); the Dockerfiles themselves run
unmodified on CI (`ubuntu-latest`, amd64) — see
[Two builders, one pinned compiler artifact](#two-builders-one-pinned-compiler-artifact)
for why nothing in either Dockerfile is arm64-specific. **The resulting
`policy.wasm` hash is not the same on amd64** — see
[Reproducibility is per-architecture](#reproducibility-is-per-architecture)
immediately below; this is expected, not a gap.

## Reproducibility is per-architecture

Verified by testing (`docker run --platform linux/amd64`, QEMU-emulated,
since the local dev machine is arm64), not assumed: pulling the identical
pinned toolchain digest on amd64 vs arm64 produces a **different**
`wasm32-unknown-unknown` rust-std component —

```
target-rustlib sha256, arm64: e10e6e257288621cb76c08fd3d48f027f780ee38f92b4ef063ff564b759f7912
target-rustlib sha256, amd64: f055727c38109d20b7b4d90524a12350db5344d73463b7fbcec7fd20a23b4cd6
```

— and consequently a different `policy.wasm` on amd64
(`bc5224f3b11e4a3cbf0cad594a5721cba7fecfc49da35c99171470c75fefb498`,
confirmed with builder B).

**Builder A's amd64 status is unresolved — see
[Native linux/amd64 cross-architecture validation (experimental)](#native-linuxamd64-cross-architecture-validation-experimental)
below.** An earlier revision of this document concluded that builder A's
crash under local QEMU emulation was "a plausible limitation of binary
translation... not evidence of a real problem, since GitHub Actions'
`ubuntu-latest` runners are genuine amd64 hardware rather than emulated."
**That conclusion was incorrect.** The identical crash was subsequently
reproduced on native GitHub-hosted amd64 hardware, confirming the issue is
independent of emulation — recorded here so the wrong conclusion doesn't
quietly persist alongside the corrected one.

This isn't a bug: `rustup` ships the target component as part of each
*host's own* toolchain bundle, so it inherits the same
"compiler-host-identity-leaks-into-the-artifact" mechanism diagnosed below
for rustc/cargo themselves — a different host arch is a different compiler
artifact in exactly the sense the [scope of the guarantee](#acceptance-statement)
already names. `scripts/policy-reproducibility.sh` reflects this: it
compares builder A's and builder B's target-rustlib hash to *each other*,
never to a fixed cross-architecture constant — asserting one would fail by
construction on whichever CI runner architecture didn't produce it.
Reproducibility holds **within** one architecture, not **across**
architectures — a distinct pinned build profile per architecture, each
independently reproducible in principle. In practice this is currently
*proven* on arm64 (A == B, above) and *not yet proven* on amd64 — see
immediately below.

## Native linux/amd64 cross-architecture validation (experimental)

Native amd64 currently fails nondeterministically. The toolchain itself
starts correctly and resolves its musl runtime dependencies — confirmed:
`rustc -vV`, `cargo -V`, and the musl loader's own `--list` all resolve
`libgcc_s.so.1` correctly on amd64 after fixing a missing
`libc.musl-<arch>.so.1` alias (builder A only copied the loader under its
own filename, not this SONAME alias `libgcc_s.so.1` itself depends on;
confirmed with `readelf -d` against the pinned source image, not guessed).
But a full `cargo build` can still fail with `SIGSEGV` while executing
host build-script binaries such as those generated for `proc-macro2` or
`serde_json`. The same behavior has been reproduced both under QEMU and on
native GitHub-hosted amd64 runners — real, not an emulation artifact (see
the correction above).

What's confirmed so far:

- Native GitHub-hosted amd64 fails; QEMU-emulated amd64 fails the same way.
- arm64 does not fail — same source, same pinned toolchain, same
  Dockerfile logic, zero failures observed.
- The musl loader and `libc.musl-<arch>.so.1` SONAME-alias fixes are
  confirmed necessary and working (`rustc -vV`/`cargo -V`/loader
  `--list` all resolve correctly on amd64 now).
- The crash occurs specifically in host build-script binaries (compiled
  by `musl-gcc` for the pinned compiler's own host target), not in the
  pinned toolchain's own pre-built `rustc`/`cargo` binaries.
- Which crate's build script crashes varies between runs (`proc-macro2`,
  `serde_json`, ...) — not one crate's own code being at fault.
- The failure is nondeterministic: the same image, rebuilt from scratch,
  sometimes succeeds and sometimes crashes.
- The release path does not depend on amd64 — it is locked to arm64 (see
  above), so this does not block the release reproducibility guarantee.

**Not yet confirmed:** a specific root cause. A `fork()`/`exec()`
interaction in the musl cross-toolchain setup — build scripts spawn a
`rustc --version` child process, and dynamically-linked musl binaries
running under a glibc host kernel via `musl-gcc`'s cross-linked runtime is
exactly the kind of combination where fork-safety issues manifest
nondeterministically — is a justified suspicion given where and how it
fails, **not a proven root cause**. Treat it as a lead for the tracked
investigation, not a conclusion.

This is tracked as a non-blocking, experimental CI job
(`cross-architecture-amd64` in `.github/workflows/ci.yml`,
`continue-on-error: true`) rather than folded into the release gate, and
as a separate investigation issue
(the separately tracked amd64 investigation) rather than closed out here. On failure,
that job uploads targeted diagnostics (`rustc -vV`, `cargo -V`, `uname -a`,
loader/libgcc digests, `Cargo.lock` hash, a verbose `cargo build -vv` log,
and `file`/`readelf` output for the crashed build-script binaries) as a CI
artifact — deliberately not full core dumps or repeated rebuild loops;
chasing this locally already cost one development machine 54GB of disk
before the investigation was intentionally paused and hooked into CI's
per-run disposable environment instead.

**The release artifact is locked to one architecture, not whichever
machine ran the script most recently.** `packages/config/profiles/ddn-wasm-v1.json`
records `toolchain.releaseBuildArchitecture` (see
`docs/execution-profile-v1.md`) the first time
`scripts/policy-reproducibility.sh` succeeds. Every later run compares its
own architecture against that lock:

- **Matches** (or no lock recorded yet): proceeds as a release action —
  writes `policy.wasm`, `manifest.json`, and the profile's `toolchain`
  block.
- **Doesn't match**: proves A == B on *this* architecture (a real,
  useful "cross-architecture validation" result — printed as such) but
  writes nothing. The release stays exactly as the locked architecture
  left it.

This is why CI's `cross-architecture-amd64` job (GitHub Actions
`ubuntu-latest`, amd64) running the identical script as a local arm64 dev
machine doesn't fight over which architecture's digests belong in the
committed profile — CI runs the same real check, gets a real result, and
neither silently overwrites the other. Deliberately changing the release
architecture (e.g. adopting amd64 as the shipped target) means editing or
removing `toolchain.releaseBuildArchitecture` first, then re-running on
the new target — a tracked, explicit action, not a side effect of running
the script somewhere else. (In amd64's current state — see
[below](#native-linuxamd64-cross-architecture-validation-experimental) —
that job frequently fails before reaching this comparison at all; that's
a separate, tracked problem, not a change to this mechanism's design.)

## Two builders, one pinned compiler artifact

Earlier revisions of this check varied the compiler's own host build
between the two Dockerfiles (a glibc-hosted `rustc` in builder A, a
musl-hosted one in builder B) on the theory that this was the strongest
possible test of "does the environment leak into the artifact." It wasn't
— see the next section for what that actually tested and why it isn't the
right acceptance gate. Both builders now `COPY --from=` the *exact same*
pinned image by digest:

```
rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35
```

— a multi-arch image index (verified with `docker buildx imagetools
inspect`), so this digest resolves correctly on both amd64 (CI) and arm64
(local) without any Dockerfile branching.

Why musl-hosted (not glibc-hosted) as the one pinned compiler: running a
musl-built binary under a glibc userland only needs musl's own small,
self-contained runtime pieces (below). The reverse — running a glibc-built
`rustc` under Alpine — needs a full glibc compatibility layer; `gcompat` is
missing symbols `rustc`/`cargo` require (e.g. `__res_init`), and the only
alternative glibc package for Alpine (`sgerrand/alpine-pkg-glibc`) has no
aarch64 build at all. The musl-hosted direction is the one that actually
works on both CI's amd64 runners and arm64 dev machines.

What each Dockerfile does, beyond the pinned compiler:

- **Builder A** (`debian:bookworm-slim`, pinned by digest) additionally
  installs `ca-certificates` (for cargo's TLS to crates.io) and
  `musl-tools` (a musl-targeting linker — see
  [below](#why-a-second-fix-was-needed-at-link-time)), then places the
  runtime pieces the pinned musl binaries need at the exact paths their own
  ELF metadata requests (see next section) — no wrapper scripts, no
  `LD_LIBRARY_PATH`.
- **Builder B** (`alpine:3.20`, pinned by digest) is the native home of the
  pinned compiler and needs no compatibility shims at all.
- Both set `CARGO_INCREMENTAL=0` and use the identical `WORKDIR` (`/build`)
  — Rust's `file!()` macro embeds the compile-time source path in panic
  messages, so a WORKDIR mismatch between builders would produce a false
  negative unrelated to real non-determinism.
- Both build with `--locked`, so both use the exact dependency versions
  from the committed `Cargo.lock`.

The WASM binary format has no timestamp field (unlike native ELF/PE), so
build-time embedding of dates/timestamps is not a concern here the way it
would be for a native binary.

## Why the compiler artifact itself is pinned, not just its version

The original design (two different rustc *host builds*, same version)
produced a real, reproducible `REPRODUCIBILITY FAILURE` — worth recording
because it wasn't the usual suspect. Diagnosed with `cargo build -vv` and
`wasm2wat`, not guessed:

- Every path string embedded in both `policy.wasm` builds was byte-for-byte
  identical (registry paths, `rustc` source paths, local crate paths).
- `rustc --version --verbose` reported the identical `commit-hash` on both
  builders.
- Rebuilding builder A from scratch (`--no-cache`) reproduced its own first
  hash exactly — so the divergence wasn't run-to-run nondeterminism either.
- `cargo build -vv` showed Cargo computing a *different* `-C metadata` hash
  per crate — including for `serde_json`/`serde_core`, compiled purely for
  the `wasm32-unknown-unknown` target — between the two builders, even
  though source, `Cargo.lock`, and rustc version were identical.

Root cause: Cargo's per-crate fingerprint folds in the compiler's own
identity (`rustc -vV`'s `host:` field), which genuinely differed —
`aarch64-unknown-linux-gnu` vs `aarch64-unknown-linux-musl` — because the
two builders used two different host builds of the *same* rustc version.
That fingerprint becomes part of Rust's mangled-symbol hash suffix, so
`serde_json`/`serde_core`'s compiled bytes differed by exactly that,
producing two different (but each internally valid and deterministic)
`policy.wasm` files. Rust/Cargo does not currently guarantee byte-identical
output across different compiler host builds, even at the same semantic
version — this is the gap the "scope of the guarantee" sentence above
exists to name explicitly, so it can't quietly get re-broadened later.

**Decision:** don't chase that as a reproducibility requirement. Hold the
compiler binary itself as one pinned, controlled variable, and let the
*userland around it* (Debian/glibc vs Alpine/musl — different libc,
different default tooling, different filesystem layout) be the thing that
varies. A design that varies every variable at once and then explains away
the resulting difference is not a stronger test; it's a confound.

## Why the pinned musl binaries need help outside their native Alpine home

The toolchain's real per-toolchain binaries (`rustc`, `cargo`, under
`/usr/local/rustup/toolchains/<host>/bin/`) are musl-dynamic and declare
`PT_INTERP /lib/ld-musl-<arch>.so.1` (checked with `readelf -l`). The
top-level proxies in `/usr/local/cargo/bin/` are fully static musl binaries
(`ldd` reports "Not a valid dynamic program") and need no help at all.

Builder A copies, from the same pinned digest as the compiler itself
(never from Debian's own `musl`/`libgcc-s1` apt packages — see next
paragraph for why):

- `/lib/ld-musl-*.so.1` — the musl loader.
- `libgcc_s.so.1` and `libgcc_s.so` (a tiny GNU ld script:
  `GROUP ( libgcc_s.so.1 -lgcc )`, not a real library) — into
  `musl-tools`' own per-arch directory
  (`/usr/lib/<triple>-linux-musl/`), not plain `/usr/lib` (see
  [link-time section](#why-a-second-fix-was-needed-at-link-time) below for
  why that distinction matters).

**Why not Debian's own `musl` + `libgcc-s1` apt packages instead of copying
these files from the pinned image?** Tested, not assumed. Debian's `musl`
apt package provides a working loader. But Debian's `libgcc-s1` is a
different libgcc build than the one the pinned musl `rustc`/`cargo` were
linked against: loading it produces
`Error relocating .../cargo: _dl_find_object: symbol not found` — a real,
reproducible ABI mismatch, not a hypothetical one. Sourcing both files from
the same pinned digest as the compiler is also the stronger reproducibility
property: everything compiler-adjacent traces to one source instead of
two independently-versioned ones.

### The runtime fix: musl's loader search path

Placing `libgcc_s.so.1` at the byte-identical path from the pinned image
was not, by itself, enough — `cargo --version` still failed with
`Error loading shared library libgcc_s.so.1: No such file or directory`.
Diagnosed with `readelf`/`nm`, not guessed:

- `cmp` confirmed the copied file is byte-for-byte identical to the source
  (ruled out: wrong file or a symlink to the wrong target).
- `readelf --wide --dyn-syms` / `--version-info` confirmed every
  `_Unwind_*` symbol `cargo`'s dynamic table requires — including its exact
  version node (`GCC_3.0`, `GCC_3.3`, `GCC_4.2.0`, `GLIBC_2.0`) — is present
  in the copied `libgcc_s.so.1`'s own version-definition table (ruled out:
  symbol or ABI-version mismatch).
- `readelf -d` showed `cargo`'s only `RPATH` is `$ORIGIN/../lib`, which does
  not contain `libgcc_s.so.1` (it lives at `/usr/lib/libgcc_s.so.1`, outside
  that relative path).

Root cause: without Debian's own `musl` apt package (deliberately not
installed — see above), there is no `/etc/ld-musl-<arch>.path` file, and
musl's dynamic loader has **no built-in default search path at all** in
that case — it only searches `RPATH`, `LD_LIBRARY_PATH`, and whatever that
config file lists. Confirmed directly: adding
`echo /usr/lib > /etc/ld-musl-aarch64.path` (or, in the final Dockerfile,
the `musl-tools` directory — see next section) made `cargo --version`
succeed immediately, with no other change.

**`LD_LIBRARY_PATH` was deliberately not used**, even though it also
"fixes" this. Setting it would paper over a missing piece of runtime
packaging rather than supply it — it's an environment-variable override
that has to be remembered and re-applied at every invocation, versus a
config file that's part of the image once and applies unconditionally.
`/etc/ld-musl-<arch>.path` is musl's own, intended mechanism for exactly
this; it's what's installed instead.

### Why a second fix was needed at link time

Fixing the runtime loader above was necessary but not sufficient: `cargo
build` still failed differently, linking `serde_derive` (a proc-macro,
compiled for the pinned compiler's own host target —
`aarch64-unknown-linux-musl` — regardless of Debian's glibc userland):

```
/usr/bin/ld: cannot find libgcc_s.so.1: No such file or directory
```

This is a *different* search mechanism from the runtime loader above:
`ld`'s own link-time library search path, driven by `musl-gcc`'s own
specs file rather than musl's loader config. Verbose inspection
(`musl-gcc -v`) showed the actual `collect2`/`ld` invocation passes exactly
two `-L` directories: `musl-tools`' own per-arch prefix
(`/usr/lib/<triple>-linux-musl/`) and its own gcc directory — deliberately
excluding plain `/usr/lib`, so it can't accidentally link a Debian glibc
library into a musl-target build by mistake. A copy placed in plain
`/usr/lib` (which fixed the runtime case) is invisible to this specific
invocation.

Fix: place `libgcc_s.so.1` and the `libgcc_s.so` link script in
`musl-tools`' own directory instead — the same one used for
`CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc`'s own bundled
musl runtime (`crti.o`, `crtn.o`, static `libc.so`/`libgcc.a`, all of which
already resolved correctly on their own — only `libgcc_s.so.1` was missing,
because Alpine's pinned `rustc`/`cargo` were the only source for that
specific file). `/etc/ld-musl-<arch>.path` (the runtime fix above) points
at this same directory rather than a second location, so there is exactly
one place these files live.

## Running it

```bash
pnpm run policy:reproducibility
# or directly:
./scripts/policy-reproducibility.sh
```

The script verifies the pinned image digests, prints the resolved
`rustc -vV` / `cargo -V` and every digest listed above before building
anything, builds both environments from a clean state, and compares the
resulting `policy.wasm` with both SHA-256 and `cmp`. It fails immediately —
before attempting either build — if any pinned digest doesn't match, and
fails after both builds if the two `policy.wasm` files differ by so much as
one byte. See `scripts/policy-reproducibility.sh` for the exact checks and
`scripts/policy-reproducibility-negative-tests.sh` for proof that each of
those checks actually catches what it claims to (wrong image digest,
tampered `Cargo.lock`, tampered target rustlib, a single flipped byte in
`policy.wasm`, a different build flag).

On success, it overwrites `policies/negotiation-v1/package/policy.wasm`
with the reproducibility-checked artifact and regenerates `manifest.json`.

## Known limitations

- **Reproducibility is guaranteed for the defined pinned build profile
  only** (see [scope of the guarantee](#acceptance-statement) above) — not
  across different Rust compiler host builds. That comparison (same
  source, same `Cargo.lock`, deliberately *different* compiler host
  builds) is a real and separately interesting question, tracked as a
  future **diverse toolchain validation** check rather than folded into
  this one. It would assert: both a glibc-hosted and a musl-hosted build
  pass the same test vectors and produce the same `outputHash` for every
  accepted input — but *not* the same `policy.wasm` bytes or `policyHash`,
  since DDN binds a decision to a specific policy artifact, and a
  different WASM hash is a different artifact even when its semantics are
  identical.
- **Base OS image pinning is by digest for the compiler source and both
  builder base images** (recorded above and checked by the script); it is
  not yet re-verified against a Debian/Alpine security-update cadence — a
  pinned digest is reproducible by construction but does mean rebuilding
  from an intentionally-updated digest is a deliberate, tracked action,
  not an automatic one.
- **Reproducibility is per-architecture** (see
  [above](#reproducibility-is-per-architecture)) — proven A == B on arm64,
  the locked release architecture. amd64 is not yet proven — see
  [Native linux/amd64 cross-architecture validation (experimental)](#native-linuxamd64-cross-architecture-validation-experimental)
  — and is tracked as a non-blocking, experimental CI job plus a separate
  investigation issue (the separately tracked amd64 investigation), not
  silently ignored or hidden inside the release gate.
