#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Collects diagnostics when the "Experimental cross-architecture validation
# (linux/amd64)" CI job fails (see .github/workflows/ci.yml and the tracked
# investigation issue, the separately tracked amd64 investigation). Called
# only on failure, from CI -- not meant for routine local use.
#
# Deliberately lean: no core dumps, one rebuild (not a retry loop) to
# capture the crashed build-script binaries for inspection. Local
# debugging of this same failure already consumed 54GB of disk on one
# machine chasing it with repeated rebuilds; this script is intentionally
# not that.
set -uo pipefail
cd "$(dirname "$0")/.."

OUT=/tmp/amd64-diagnostics
mkdir -p "$OUT"

TOOLCHAIN_IMAGE="rust:1.94.1-alpine3.20@sha256:6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35"

{
  echo "=== uname -a ==="
  uname -a
  echo
  echo "=== rustc -vV (pinned toolchain image, native to this runner's arch) ==="
  docker run --rm "$TOOLCHAIN_IMAGE" rustc -vV
  echo
  echo "=== cargo -V ==="
  docker run --rm "$TOOLCHAIN_IMAGE" cargo -V
  echo
  echo "=== Cargo.lock sha256 ==="
  sha256sum Cargo.lock
  echo
  echo "=== component digests (from pinned toolchain image) ==="
  docker run --rm "$TOOLCHAIN_IMAGE" sh -c '
    sha256sum /lib/ld-musl-*.so.1 /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so 2>&1
  '
} >"$OUT/summary.txt" 2>&1

BUILD_CONTEXT=$(mktemp -d)
trap 'rm -rf "$BUILD_CONTEXT"' EXIT
cp Cargo.toml Cargo.lock "$BUILD_CONTEXT/"
mkdir -p "$BUILD_CONTEXT/packages/canonical-json" "$BUILD_CONTEXT/packages/crypto"
cp -r packages/canonical-json/rust "$BUILD_CONTEXT/packages/canonical-json/rust"
cp -r packages/crypto/rust "$BUILD_CONTEXT/packages/crypto/rust"
cp -r policies "$BUILD_CONTEXT/policies"
mkdir -p "$BUILD_CONTEXT/apps"
cp -r apps/validator "$BUILD_CONTEXT/apps/validator"

# Same as infra/docker/policy-builder-a.Dockerfile up to (not including)
# the final `cargo build`/CMD lines, then a verbose build that continues
# past a crash (`|| true`) instead of aborting, so the crashed
# build-script-build binaries are still on disk to inspect afterward.
DIAG_DOCKERFILE="$BUILD_CONTEXT.Dockerfile"
sed '/^RUN cargo build --locked --release/,$d' infra/docker/policy-builder-a.Dockerfile >"$DIAG_DOCKERFILE"
cat >>"$DIAG_DOCKERFILE" <<'STEPS'
RUN apt-get update && apt-get install -y --no-install-recommends binutils file
RUN cargo build --locked --release --target wasm32-unknown-unknown -p ddn-negotiation-v1 -vv > /tmp/cargo-vv.log 2>&1 ; true
RUN { for f in $(find target -name build-script-build 2>/dev/null); do echo "=== $f ==="; file "$f"; readelf -d "$f" 2>&1; echo; done; } > /tmp/build-script-binaries.log 2>&1 ; true
STEPS

docker build -f "$DIAG_DOCKERFILE" -t ddn-amd64-diag "$BUILD_CONTEXT" >"$OUT/diagnostic-build.log" 2>&1
CID=$(docker create ddn-amd64-diag 2>/dev/null || true)
if [ -n "${CID:-}" ]; then
  docker cp "$CID:/tmp/cargo-vv.log" "$OUT/cargo-vv.log" 2>/dev/null || true
  docker cp "$CID:/tmp/build-script-binaries.log" "$OUT/build-script-binaries.log" 2>/dev/null || true
  docker rm "$CID" >/dev/null 2>&1 || true
fi

echo "Diagnostics written to $OUT:"
ls -la "$OUT"
