#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds policies/negotiation-v1 to WASM and assembles the policy package
# directory (policy.wasm, manifest.json, schemas, reason codes, test
# vectors) that apps/validator (ddn-validator) consumes. See
# docs/execution-profile-v1.md and docs/negotiation-policy-v1.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! rustup target list --installed | grep -qx 'wasm32-unknown-unknown'; then
  echo 'missing required Rust target: wasm32-unknown-unknown' >&2
  echo 'install it explicitly before running this script; the build never installs toolchains implicitly' >&2
  exit 1
fi

cargo build --release --target wasm32-unknown-unknown -p ddn-negotiation-v1

PKG_DIR="policies/negotiation-v1/package"
mkdir -p "$PKG_DIR"

cp target/wasm32-unknown-unknown/release/ddn_negotiation_v1.wasm "$PKG_DIR/policy.wasm"
cp packages/schemas/json/negotiation-input-v1.schema.json "$PKG_DIR/input.schema.json"
cp packages/schemas/json/negotiation-output-v1.schema.json "$PKG_DIR/output.schema.json"
cp packages/schemas/json/reason-codes-v1.json "$PKG_DIR/reason-codes.json"
cp packages/test-vectors/vectors/negotiation-v1.json "$PKG_DIR/test-vectors.json"

node scripts/gen-manifest.mjs "$PKG_DIR"

echo "wrote $PKG_DIR"
