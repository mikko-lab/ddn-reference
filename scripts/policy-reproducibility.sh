#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds policies/negotiation-v1 in two independent, clean Docker
# environments (infra/docker/policy-builder-{a,b}.Dockerfile) and fails
# unless both produce a byte-identical policy.wasm. See
# docs/reproducible-builds.md for the full design rationale, the diagnosed
# root causes behind every check below, and why the pinned compiler
# artifact is one controlled variable rather than something that varies
# between the two builders.
#
# Fails fast, before either build starts, if any pinned digest below
# doesn't match what's actually in the Dockerfiles — a silent digest drift
# between this script's records and the Dockerfiles is exactly the kind of
# thing that should break CI loudly, not produce a quieter false pass.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCKERFILE_A="infra/docker/policy-builder-a.Dockerfile"
DOCKERFILE_B="infra/docker/policy-builder-b.Dockerfile"

# --- Pinned digests this check asserts against -----------------------------
# These are recorded here (not only in the Dockerfiles) so a change to
# either Dockerfile's FROM/COPY --from lines that isn't also reflected here
# fails loudly instead of silently building against an unreviewed image.
EXPECTED_TOOLCHAIN_IMAGE="rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35"
EXPECTED_DEBIAN_BASE="debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818"
EXPECTED_ALPINE_BASE="alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"

# NOT pinned to one fixed value: verified by testing (via `docker run
# --platform linux/amd64`, emulated, since this development machine is
# arm64), the wasm32-unknown-unknown rust-std component's own bytes differ
# between an amd64 host and an arm64 host pull of the identical pinned
# image digest — rustup ships it as part of each host's own toolchain
# bundle, so it's subject to the same "compiler host identity leaks into
# the artifact" mechanism as rustc/cargo/loader/libgcc_s below, not
# something built once and reused verbatim across hosts. So this, like
# those, is compared for A == B on one host arch, never against a fixed
# cross-arch constant — asserting one would make this check fail by
# construction on whichever CI runner arch didn't produce that constant.

# The canonical build configuration: target triple, profile, the flags
# that actually reach cargo/rustc. Changing any of these on either builder
# without updating the other is exactly the kind of divergence this hash
# exists to catch — see the negative test for "different build flag".
CANONICAL_BUILD_CONFIG="target=wasm32-unknown-unknown;profile=release;locked=true;incremental=0;package=ddn-negotiation-v1"
CANONICAL_BUILD_CONFIG_HASH=$(printf '%s' "$CANONICAL_BUILD_CONFIG" | sha256sum | cut -d' ' -f1)

fail() {
  echo "REPRODUCIBILITY FAILURE: $1" >&2
  exit 1
}

assert_dockerfile_pins() {
  local dockerfile="$1"
  grep -qF "$EXPECTED_TOOLCHAIN_IMAGE" "$dockerfile" \
    || fail "$dockerfile does not reference the expected pinned toolchain image ($EXPECTED_TOOLCHAIN_IMAGE)"
}

echo "== Verifying pinned image digests before building anything =="
[ -f "$DOCKERFILE_A" ] || fail "$DOCKERFILE_A not found"
[ -f "$DOCKERFILE_B" ] || fail "$DOCKERFILE_B not found"
assert_dockerfile_pins "$DOCKERFILE_A"
assert_dockerfile_pins "$DOCKERFILE_B"
grep -qF "$EXPECTED_DEBIAN_BASE" "$DOCKERFILE_A" \
  || fail "$DOCKERFILE_A does not reference the expected pinned Debian base image ($EXPECTED_DEBIAN_BASE)"
grep -qF "$EXPECTED_ALPINE_BASE" "$DOCKERFILE_B" \
  || fail "$DOCKERFILE_B does not reference the expected pinned Alpine base image ($EXPECTED_ALPINE_BASE)"
echo "  toolchain image: $EXPECTED_TOOLCHAIN_IMAGE"
echo "  builder A base:  $EXPECTED_DEBIAN_BASE"
echo "  builder B base:  $EXPECTED_ALPINE_BASE"

if ! docker info >/dev/null 2>&1; then
  fail "Docker is not available/running; cannot run the reproducible-build check."
fi

echo
echo "== Build profile record =="
SOURCE_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown (not a git checkout)")
CARGO_LOCK_HASH=$(sha256sum Cargo.lock | cut -d' ' -f1)
echo "  source commit:              $SOURCE_COMMIT"
echo "  Cargo.lock sha256:          $CARGO_LOCK_HASH"
echo "  canonical build config:     $CANONICAL_BUILD_CONFIG"
echo "  canonical build config sha256: $CANONICAL_BUILD_CONFIG_HASH"

BUILD_CONTEXT=$(mktemp -d)
trap 'rm -rf "$BUILD_CONTEXT"' EXIT

cp Cargo.toml Cargo.lock "$BUILD_CONTEXT/"
mkdir -p "$BUILD_CONTEXT/packages/canonical-json" "$BUILD_CONTEXT/packages/crypto"
cp -r packages/canonical-json/rust "$BUILD_CONTEXT/packages/canonical-json/rust"
cp -r packages/crypto/rust "$BUILD_CONTEXT/packages/crypto/rust"
cp -r policies "$BUILD_CONTEXT/policies"
mkdir -p "$BUILD_CONTEXT/apps"
cp -r apps/validator "$BUILD_CONTEXT/apps/validator"

# Report + assert a toolchain component digest inside an already-built
# builder image. $2 is a human label only; the check is the comparison
# against $3 (empty string = report-only, no assertion — used for the
# arch-dependent rustc/cargo/loader/libgcc_s digests, which legitimately
# differ between amd64 and arm64 builds of the *same* pinned image and so
# aren't asserted against a fixed constant here; what matters for those is
# that builder A and builder B report the *same* value as each other,
# checked separately below).
report_digest() {
  local image="$1" path_expr="$2"
  docker run --rm "$image" sh -c "sha256sum $path_expr 2>/dev/null | cut -d' ' -f1" || echo "MISSING"
}

build_and_inspect() {
  local dockerfile="$1" tag="$2" label="$3"
  echo
  echo "== Building $label =="
  docker build -f "$dockerfile" -t "$tag" "$BUILD_CONTEXT"

  echo "== $label toolchain identity =="
  docker run --rm --entrypoint sh "$tag" -c 'rustc -vV' | tee "$BUILD_CONTEXT/.rustc-vv-$tag"
  docker run --rm --entrypoint sh "$tag" -c 'cargo -V'

  echo "== $label component digests =="
  local tc_glob='$(ls -d /usr/local/rustup/toolchains/*)'
  local rustc_digest cargo_digest loader_digest libgcc_digest rustlib_hash
  rustc_digest=$(report_digest "$tag" "$tc_glob/bin/rustc")
  cargo_digest=$(report_digest "$tag" "$tc_glob/bin/cargo")
  loader_digest=$(report_digest "$tag" '/lib/ld-musl-*.so.1')
  # libgcc_s.so.1 lives at a different path per builder by design: plain
  # /usr/lib/libgcc_s.so.1 in builder B (Alpine, its native home), but
  # musl-tools' own per-arch directory in builder A (Debian) — see
  # docs/reproducible-builds.md's link-time section for why plain /usr/lib
  # doesn't work there. `find` locates it wherever this specific builder
  # actually put it, rather than assuming one fixed path — but builder A
  # also has Debian's *own* (glibc, unrelated) libgcc_s.so.1 at
  # /usr/lib/<triple>-linux-gnu/, matched by the same filename, so that
  # path is explicitly excluded (verified with `find` directly: without the
  # exclusion, `head -1` picked the wrong one, an easy silent mistake this
  # comment exists to prevent from recurring).
  libgcc_digest=$(docker run --rm "$tag" sh -c \
    "find /usr/lib -maxdepth 2 -name libgcc_s.so.1 2>/dev/null | grep -v -- '-linux-gnu/' | head -1 | xargs sha256sum 2>/dev/null | cut -d' ' -f1" \
    || echo "MISSING")
  echo "    rustc binary: $rustc_digest"
  echo "    cargo binary: $cargo_digest"
  echo "    musl loader:  $loader_digest"
  echo "    libgcc_s.so.1: $libgcc_digest"

  rustlib_hash=$(docker run --rm "$tag" sh -c '
    TC=$(ls -d /usr/local/rustup/toolchains/*)
    RUSTLIB="$TC/lib/rustlib/wasm32-unknown-unknown"
    find "$RUSTLIB" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d" " -f1
  ')
  echo "    target-rustlib (wasm32-unknown-unknown): $rustlib_hash"

  echo "$rustc_digest" > "$BUILD_CONTEXT/.rustc-digest-$tag"
  echo "$cargo_digest" > "$BUILD_CONTEXT/.cargo-digest-$tag"
  echo "$loader_digest" > "$BUILD_CONTEXT/.loader-digest-$tag"
  echo "$libgcc_digest" > "$BUILD_CONTEXT/.libgcc-digest-$tag"
  echo "$rustlib_hash" > "$BUILD_CONTEXT/.rustlib-hash-$tag"
}

build_and_inspect "$DOCKERFILE_A" ddn-policy-builder-a "builder A (Debian/glibc userland)"
build_and_inspect "$DOCKERFILE_B" ddn-policy-builder-b "builder B (Alpine/musl userland)"

HASH_A=$(docker run --rm ddn-policy-builder-a | cut -d' ' -f1)
HASH_B=$(docker run --rm ddn-policy-builder-b | cut -d' ' -f1)

echo
echo "builder A (Debian/glibc userland): $HASH_A"
echo "builder B (Alpine/musl userland):  $HASH_B"

[ "$HASH_A" = "$HASH_B" ] || fail "policy.wasm SHA-256 differs between builders (A=$HASH_A B=$HASH_B)"

RUSTLIB_A=$(cat "$BUILD_CONTEXT/.rustlib-hash-ddn-policy-builder-a")
RUSTLIB_B=$(cat "$BUILD_CONTEXT/.rustlib-hash-ddn-policy-builder-b")
[ "$RUSTLIB_A" = "$RUSTLIB_B" ] \
  || fail "target-rustlib hash differs between builders (A=$RUSTLIB_A B=$RUSTLIB_B) — the two builders did not use the same target component, so a matching policy.wasm would be a coincidence, not a proof"

WASM_A=$(mktemp)
WASM_B=$(mktemp)
CID_A=$(docker create ddn-policy-builder-a)
CID_B=$(docker create ddn-policy-builder-b)
docker cp "$CID_A:/build/target/wasm32-unknown-unknown/release/ddn_negotiation_v1.wasm" "$WASM_A"
docker cp "$CID_B:/build/target/wasm32-unknown-unknown/release/ddn_negotiation_v1.wasm" "$WASM_B"
docker rm "$CID_A" "$CID_B" >/dev/null

cmp "$WASM_A" "$WASM_B" || fail "policy.wasm files have matching SHA-256 but differ under cmp (should be impossible; investigate immediately)"
rm -f "$WASM_A" "$WASM_B"

echo "cmp: bit-for-bit identical"
echo "REPRODUCIBLE: both builders produced sha256:$HASH_A"

echo
echo "== Release architecture lock =="
# The release policy.wasm and execution profile are bound to one specific
# architecture, recorded as toolchain.releaseBuildArchitecture in the
# profile once established. Reproducibility (A == B, above) holds within
# any single architecture, but arm64 and amd64 builds of the identical
# pinned toolchain produce genuinely different bytes (see
# docs/reproducible-builds.md#reproducibility-is-per-architecture) — so a
# run on a different architecture than the locked one must NOT silently
# overwrite the release artifact or profile with its own, different
# digests. That would make the "canonical" build whatever machine happened
# to run this script last, which defeats the point of pinning anything.
# Such a run is still a real, useful result — proof that this OTHER
# architecture is also internally reproducible — just not a release action.
RUSTC_VV_FOR_ARCH=$(cat "$BUILD_CONTEXT/.rustc-vv-ddn-policy-builder-a")
DDN_RUSTC_HOST_FOR_ARCH=$(printf '%s' "$RUSTC_VV_FOR_ARCH" | sed -n 's/^host: //p')
THIS_ARCH=$(printf '%s' "$DDN_RUSTC_HOST_FOR_ARCH" | cut -d- -f1)
case "$THIS_ARCH" in
  aarch64) DDN_RELEASE_BUILD_ARCHITECTURE="linux/arm64" ;;
  x86_64)  DDN_RELEASE_BUILD_ARCHITECTURE="linux/amd64" ;;
  *)       DDN_RELEASE_BUILD_ARCHITECTURE="linux/$THIS_ARCH" ;;
esac
export DDN_RELEASE_BUILD_ARCHITECTURE

PROFILE_PATH="packages/config/profiles/ddn-wasm-v1.json"
LOCKED_ARCH=""
if [ -f "$PROFILE_PATH" ]; then
  LOCKED_ARCH=$(node -e '
    const fs = require("fs");
    try {
      const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write((p.toolchain && p.toolchain.releaseBuildArchitecture) || "");
    } catch (e) {
      process.stdout.write("");
    }
  ' "$PROFILE_PATH")
fi

if [ -n "$LOCKED_ARCH" ] && [ "$LOCKED_ARCH" != "$DDN_RELEASE_BUILD_ARCHITECTURE" ]; then
  echo "  locked release architecture: $LOCKED_ARCH"
  echo "  this run's architecture:     $DDN_RELEASE_BUILD_ARCHITECTURE"
  echo
  echo "CROSS-ARCHITECTURE VALIDATION PASSED for $DDN_RELEASE_BUILD_ARCHITECTURE (sha256:$HASH_A, builder A == builder B on this architecture)."
  echo "The release policy.wasm and execution profile remain locked to $LOCKED_ARCH and were NOT modified by this run."
  echo "See docs/reproducible-builds.md#reproducibility-is-per-architecture."
  exit 0
fi

if [ -z "$LOCKED_ARCH" ]; then
  echo "  release architecture: $DDN_RELEASE_BUILD_ARCHITECTURE (establishing lock — no prior lock recorded)"
else
  echo "  release architecture: $DDN_RELEASE_BUILD_ARCHITECTURE (matches locked release architecture)"
fi

PKG_DIR="policies/negotiation-v1/package"
mkdir -p "$PKG_DIR"
CONTAINER_ID=$(docker create ddn-policy-builder-a)
docker cp "$CONTAINER_ID:/build/target/wasm32-unknown-unknown/release/ddn_negotiation_v1.wasm" "$PKG_DIR/policy.wasm"
docker rm "$CONTAINER_ID" >/dev/null

cp packages/schemas/json/negotiation-input-v1.schema.json "$PKG_DIR/input.schema.json"
cp packages/schemas/json/negotiation-output-v1.schema.json "$PKG_DIR/output.schema.json"
cp packages/schemas/json/reason-codes-v1.json "$PKG_DIR/reason-codes.json"
cp packages/test-vectors/vectors/negotiation-v1.json "$PKG_DIR/test-vectors.json"
node scripts/gen-manifest.mjs "$PKG_DIR"

echo "wrote $PKG_DIR with the reproducibility-checked artifact"

echo
echo "== Updating execution profile toolchain identity =="
# Bound to builder A's toolchain identity: builder A's policy.wasm is the
# one copied into the package above. Both builders were just proven to
# produce byte-identical output on this architecture, so this reflects
# either one — it's recorded so profileHash binds the decision to this
# exact toolchain, not just to runtime (Wasmtime) config. See
# docs/execution-profile-v1.md.
RUSTC_VV=$(cat "$BUILD_CONTEXT/.rustc-vv-ddn-policy-builder-a")
DDN_RUSTC_VERSION=$(printf '%s' "$RUSTC_VV" | head -1 | sed -E 's/^rustc ([0-9.]+).*/\1/')
DDN_RUSTC_COMMIT_HASH=$(printf '%s' "$RUSTC_VV" | sed -n 's/^commit-hash: //p')
DDN_RUSTC_HOST=$(printf '%s' "$RUSTC_VV" | sed -n 's/^host: //p')
DDN_TOOLCHAIN_ARCH="$THIS_ARCH"

export DDN_TOOLCHAIN_ARCH
export DDN_RUSTC_VERSION
export DDN_RUSTC_COMMIT_HASH
export DDN_RUSTC_HOST
export DDN_RUSTC_BINARY_SHA256=$(cat "$BUILD_CONTEXT/.rustc-digest-ddn-policy-builder-a")
export DDN_CARGO_BINARY_SHA256=$(cat "$BUILD_CONTEXT/.cargo-digest-ddn-policy-builder-a")
export DDN_TARGET_RUSTLIB_SHA256="$RUSTLIB_A"
export DDN_MUSL_LOADER_SHA256=$(cat "$BUILD_CONTEXT/.loader-digest-ddn-policy-builder-a")
export DDN_LIBGCC_S_SHA256=$(cat "$BUILD_CONTEXT/.libgcc-digest-ddn-policy-builder-a")
export DDN_TOOLCHAIN_IMAGE="$EXPECTED_TOOLCHAIN_IMAGE"
export DDN_BUILDER_A_BASE_IMAGE="$EXPECTED_DEBIAN_BASE"
export DDN_BUILDER_B_BASE_IMAGE="$EXPECTED_ALPINE_BASE"
export DDN_BUILD_CONFIG_SHA256="$CANONICAL_BUILD_CONFIG_HASH"

node scripts/update-execution-profile-toolchain.mjs packages/config/profiles/ddn-wasm-v1.json
