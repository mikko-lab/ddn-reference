#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Proves scripts/policy-reproducibility.sh's checks have teeth: each
# scenario below deliberately breaks exactly one invariant the real check
# depends on, and asserts the check (or the specific comparison mechanism
# it uses) actually rejects it — rather than trusting that a check which
# has only ever seen matching input would also catch mismatched input.
#
# Two scenarios (wrong image digest, different build flag) run the real
# script end-to-end against a deliberately corrupted copy of one
# Dockerfile, because they're pre-flight/build-time conditions the real
# script is the natural place to exercise. The other three (tampered
# Cargo.lock, corrupted target-rustlib, one flipped policy.wasm byte)
# instead corrupt a copy of a real, already-verified artifact and re-run
# just the comparison logic the real script uses — full rebuilds for every
# scenario would multiply this script's runtime for no more coverage, since
# what's actually being proven is that the comparison itself doesn't quietly
# accept a mismatch, not that Docker can build a container.
#
# Requires a prior successful run of ./scripts/policy-reproducibility.sh
# (so ddn-policy-builder-a/-b images and policies/negotiation-v1/package/
# exist) for the three targeted tests; runs it itself if missing.
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0
FAIL=0

report() {
  local name="$1" ok="$2" detail="$3"
  if [ "$ok" = "true" ]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name -- $detail"
    FAIL=$((FAIL + 1))
  fi
}

if ! docker image inspect ddn-policy-builder-a >/dev/null 2>&1 \
  || ! docker image inspect ddn-policy-builder-b >/dev/null 2>&1; then
  echo "== No prior builder images found; running the real check once first =="
  ./scripts/policy-reproducibility.sh
fi

# --- 1. Wrong image digest --------------------------------------------------
# Full end-to-end: the real script must refuse to build anything at all.
echo
echo "== 1. Wrong image digest =="
cp infra/docker/policy-builder-a.Dockerfile /tmp/negtest-a.Dockerfile.bak
sed -i.tmp 's/6b1a8a05a7d4863f87c383ceb645bf038c5dba41e5a43fb7c7cc4a252b313a35/0000000000000000000000000000000000000000000000000000000000000/' \
  infra/docker/policy-builder-a.Dockerfile
./scripts/policy-reproducibility.sh >/tmp/negtest1.log 2>&1
exit1=$?
cp /tmp/negtest-a.Dockerfile.bak infra/docker/policy-builder-a.Dockerfile
rm -f infra/docker/policy-builder-a.Dockerfile.tmp /tmp/negtest-a.Dockerfile.bak
if [ "$exit1" -ne 0 ] && grep -q "does not reference the expected pinned toolchain image" /tmp/negtest1.log; then
  report "wrong image digest is rejected before any build" true ""
else
  report "wrong image digest is rejected before any build" false \
    "exit=$exit1, expected non-zero with a pinned-digest error before any docker build; see /tmp/negtest1.log"
fi

# --- 2. Different build flag ------------------------------------------------
# Full end-to-end: give builder B a different optimization level via
# RUSTFLAGS than builder A's default (release profile, opt-level=3). Tried
# a mismatched WORKDIR first (docs/reproducible-builds.md's original
# stated reason to keep it identical: Rust's file!() macro embeds it in
# panic messages) — verified by testing, that alone did *not* change this
# specific artifact's bytes, so it's a poor negative-test signal for this
# codebase even though it remains good practice. A different opt-level
# reliably changes codegen and is a genuine "different build configuration"
# in the sense the canonical-build-config hash exists to catch.
echo
echo "== 2. Different build flag (mismatched optimization level) =="
cp infra/docker/policy-builder-b.Dockerfile /tmp/negtest-b.Dockerfile.bak
sed -i.tmp 's#^ENV CARGO_INCREMENTAL=0#ENV CARGO_INCREMENTAL=0\nENV RUSTFLAGS=-Copt-level=1#' infra/docker/policy-builder-b.Dockerfile
./scripts/policy-reproducibility.sh >/tmp/negtest2.log 2>&1
exit2=$?
cp /tmp/negtest-b.Dockerfile.bak infra/docker/policy-builder-b.Dockerfile
rm -f infra/docker/policy-builder-b.Dockerfile.tmp /tmp/negtest-b.Dockerfile.bak
if [ "$exit2" -ne 0 ] && grep -q "policy.wasm SHA-256 differs between builders" /tmp/negtest2.log; then
  report "mismatched optimization level (different build config) is caught by the hash comparison" true ""
else
  report "mismatched optimization level (different build config) is caught by the hash comparison" false \
    "exit=$exit2, expected non-zero with a SHA-256 mismatch error; see /tmp/negtest2.log"
fi

# --- 3. Tampered Cargo.lock --------------------------------------------------
# One hex character flipped in the first real dependency checksum found
# (not tied to one specific crate name/version, so this doesn't go stale as
# dependencies get bumped). `cargo build --locked` verifies checksums
# against the actual downloaded crate, so this must fail the build itself —
# a tampered lockfile is caught before it can even produce a
# differing-but-plausible artifact, a stricter outcome than a silent
# mismatch, and the correct one.
echo
echo "== 3. Tampered Cargo.lock (flipped checksum byte) =="
cp Cargo.lock /tmp/negtest-Cargo.lock.bak
python3 - Cargo.lock <<'EOF'
import re
import sys

path = sys.argv[1]
with open(path) as f:
    text = f.read()


def flip(match):
    hex_digest = match.group(1)
    flipped = ("1" if hex_digest[0] == "0" else "0") + hex_digest[1:]
    return f'checksum = "{flipped}"'


new_text, count = re.subn(r'checksum = "([0-9a-f]{64})"', flip, text, count=1)
if count != 1:
    sys.exit("no checksum line found in Cargo.lock")
with open(path, "w") as f:
    f.write(new_text)
EOF
./scripts/policy-reproducibility.sh >/tmp/negtest3.log 2>&1
exit3=$?
cp /tmp/negtest-Cargo.lock.bak Cargo.lock
rm -f /tmp/negtest-Cargo.lock.bak
if [ "$exit3" -ne 0 ] && grep -qi "checksum" /tmp/negtest3.log; then
  report "tampered Cargo.lock checksum fails the build (--locked catches it)" true ""
else
  report "tampered Cargo.lock checksum fails the build (--locked catches it)" false \
    "exit=$exit3, expected non-zero with a checksum error; see /tmp/negtest3.log"
fi

# --- 4. Corrupted target-rustlib -------------------------------------------
# Targeted: exercises the exact aggregate-hash-and-compare logic
# scripts/policy-reproducibility.sh uses (find | sort | sha256sum |
# sha256sum), against a deliberately corrupted copy of a real toolchain's
# rustlib directory, rather than rebuilding an image with one.
echo
echo "== 4. Corrupted target-rustlib =="
RUSTLIB_WORKDIR=$(mktemp -d)
CID=$(docker create ddn-policy-builder-a)
TC_PATH=$(docker run --rm ddn-policy-builder-a sh -c 'ls -d /usr/local/rustup/toolchains/*')
docker cp "$CID:$TC_PATH/lib/rustlib/wasm32-unknown-unknown" "$RUSTLIB_WORKDIR/rustlib-good"
docker rm "$CID" >/dev/null
cp -r "$RUSTLIB_WORKDIR/rustlib-good" "$RUSTLIB_WORKDIR/rustlib-corrupted"
CORRUPT_FILE=$(find "$RUSTLIB_WORKDIR/rustlib-corrupted" -type f | head -1)
printf '\x00' | dd of="$CORRUPT_FILE" bs=1 seek=0 count=1 conv=notrunc >/dev/null 2>&1

hash_rustlib() {
  find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
}
HASH_GOOD=$(hash_rustlib "$RUSTLIB_WORKDIR/rustlib-good")
HASH_CORRUPTED=$(hash_rustlib "$RUSTLIB_WORKDIR/rustlib-corrupted")
rm -rf "$RUSTLIB_WORKDIR"

if [ "$HASH_GOOD" != "$HASH_CORRUPTED" ]; then
  report "corrupted target-rustlib produces a different aggregate hash" true ""
else
  report "corrupted target-rustlib produces a different aggregate hash" false \
    "hashes matched after corruption (good=$HASH_GOOD corrupted=$HASH_CORRUPTED) -- the aggregate hash function itself is broken"
fi

# --- 5. One-byte change to policy.wasm --------------------------------------
# Targeted: exercises the exact SHA-256 + cmp comparison the real script
# runs on the final artifact, against a one-byte-flipped copy of the real,
# already-verified policy.wasm.
echo
echo "== 5. One-byte change to policy.wasm =="
WASM_GOOD="policies/negotiation-v1/package/policy.wasm"
if [ ! -f "$WASM_GOOD" ]; then
  report "one-byte-flipped policy.wasm is rejected" false "$WASM_GOOD not found; run scripts/policy-reproducibility.sh first"
else
  WASM_FLIPPED=$(mktemp)
  cp "$WASM_GOOD" "$WASM_FLIPPED"
  # Flip the low bit of the first byte.
  python3 - "$WASM_FLIPPED" <<'EOF'
import sys
path = sys.argv[1]
with open(path, "r+b") as f:
    b = bytearray(f.read())
    b[0] ^= 0x01
    f.seek(0)
    f.write(b)
EOF
  SHA_GOOD=$(sha256sum "$WASM_GOOD" | cut -d' ' -f1)
  SHA_FLIPPED=$(sha256sum "$WASM_FLIPPED" | cut -d' ' -f1)
  if [ "$SHA_GOOD" != "$SHA_FLIPPED" ] && ! cmp -s "$WASM_GOOD" "$WASM_FLIPPED"; then
    report "one-byte-flipped policy.wasm is rejected by SHA-256 and cmp" true ""
  else
    report "one-byte-flipped policy.wasm is rejected by SHA-256 and cmp" false \
      "flip did not produce a detectable difference (should be impossible)"
  fi
  rm -f "$WASM_FLIPPED"
fi

echo
echo "== Negative test summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
