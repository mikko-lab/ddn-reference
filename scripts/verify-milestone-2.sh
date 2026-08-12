#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Runs the acceptance checks recorded in docs/milestone-2-verification.md with
# one command. Requires: pnpm, a Rust toolchain with the wasm32-unknown-unknown
# target, and (for the Solidity checks) foundry. Docker is required only for
# the reproducibility check; see docs/reproducible-builds.md if it's
# unavailable in your environment.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== TypeScript =="
pnpm install --frozen-lockfile
pnpm run build
pnpm run lint
pnpm run test
pnpm run typecheck

echo "== Rust =="
cargo build --workspace
cargo test --workspace --exclude ddn-validator
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check

echo "== Policy build (WASM) =="
./scripts/build-policy.sh

echo "== Cross-language + native-vs-WASM vectors =="
cargo test -p ddn-validator

echo "== Determinism (1000 runs) =="
cargo build --release -p ddn-validator
./target/release/ddn-validator determinism-check \
  --policy policies/negotiation-v1/package \
  --input packages/test-vectors/fixtures/negotiation-counter.json \
  --runs 1000

echo "== Reproducible build (two Docker builders) =="
if docker info >/dev/null 2>&1; then
  ./scripts/policy-reproducibility.sh
else
  echo "Docker unavailable in this environment; skipping. This step runs in CI (see .github/workflows/ci.yml)." >&2
fi

echo "== Solidity (contracts scaffold; unchanged in this milestone) =="
if command -v forge >/dev/null 2>&1; then
  (cd contracts && forge build && forge test && forge fmt --check)
else
  echo "forge not installed in this environment; skipping. This step runs in CI." >&2
fi

echo "Milestone 1-2 verification complete."
