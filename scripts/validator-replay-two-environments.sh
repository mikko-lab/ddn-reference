#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Milestone 3 hardening: proves a signed validator result can be produced
# in one clean environment and independently replay-verified in a second,
# genuinely separate one -- not just "the same code path run twice in the
# same process," which would prove nothing about isolation.
#
# Environment A (docker run, bind-mounted at its own host temp dir):
# builds an ExecutionRequestV1 against the pinned policy package, executes
# and signs it, and ends up holding four things: the policy package, the
# request, the signed result, and (only in A) the private key.
#
# Environment B (a separate docker run, from the same image, bind-mounted
# read-only at a *different* host temp dir containing only a hand-curated
# copy of the policy package + request + signed result + public key --
# never A's private key, never A's directory) must independently verify
# the policy package, re-derive the validator identity from the public
# key, verify the signature, recompute every hash, re-run policy.wasm, and
# print REPLAY_OK with exit code 0.
#
# See docs/validator-result-v1.md and infra/docker/validator-replay-runtime.Dockerfile.
#
# Requires scripts/build-policy.sh to have been run first so
# policies/negotiation-v1/package/ exists and is current.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCKERFILE="infra/docker/validator-replay-runtime.Dockerfile"
IMAGE="ddn-validator-replay-runtime"
POLICY_DIR="policies/negotiation-v1/package"
INPUT_FIXTURE="packages/test-vectors/fixtures/negotiation-counter.json"
REQUEST_ID="req-replay-two-environments-1"
EXECUTION_PROFILE_ID="ddn-wasm-v1"
PROFILE_FILE="packages/config/profiles/${EXECUTION_PROFILE_ID}.json"

fail() {
  echo "REPLAY FAILURE: $1" >&2
  exit 1
}

[ -f "$DOCKERFILE" ] || fail "$DOCKERFILE not found"
[ -f "$POLICY_DIR/policy.wasm" ] || fail "$POLICY_DIR/policy.wasm not found; run scripts/build-policy.sh first"
[ -f "$INPUT_FIXTURE" ] || fail "$INPUT_FIXTURE not found"
[ -f "$PROFILE_FILE" ] || fail "$PROFILE_FILE not found"

if ! docker info >/dev/null 2>&1; then
  fail "Docker is not available/running; cannot run the two-environment replay check."
fi

echo "== Building validator runtime image =="
docker build -f "$DOCKERFILE" -t "$IMAGE" . >/dev/null

ENV_A=$(mktemp -d)
ENV_B=$(mktemp -d)
cleanup() {
  # ENV_A holds the private key for the lifetime of this script only;
  # both directories are removed on any exit path, success or failure.
  rm -rf "$ENV_A" "$ENV_B"
}
trap cleanup EXIT

echo
echo "== Environment A: build, execute, sign =="
cp -r "$POLICY_DIR" "$ENV_A/policy"
cp "$INPUT_FIXTURE" "$ENV_A/input.json"
cp "$PROFILE_FILE" "$ENV_A/profile.json"

docker run --rm -v "$ENV_A":/work "$IMAGE" \
  keygen --private-key-out /work/validator.key >/dev/null

docker run --rm -v "$ENV_A":/work "$IMAGE" \
  build-request --policy /work/policy --profile /work/profile.json --input /work/input.json \
  --request-id "$REQUEST_ID" \
  > "$ENV_A/request.json"

docker run --rm -v "$ENV_A":/work "$IMAGE" \
  execute --policy /work/policy --profile /work/profile.json --request /work/request.json \
  --private-key-file /work/validator.key \
  > "$ENV_A/signed-result.json"

[ -s "$ENV_A/validator.key" ] || fail "Environment A did not produce a private key"
[ -s "$ENV_A/validator.pub" ] || fail "Environment A did not produce a public key"
[ -s "$ENV_A/signed-result.json" ] || fail "Environment A did not produce a signed result"
echo "  produced: policy package, request.json, signed-result.json, validator.key (A-only), validator.pub"

echo
echo "== Curating Environment B's inputs (the four allowed artifacts only) =="
# Deliberately built by copying named files one at a time -- not by
# copying ENV_A wholesale -- so it is structurally impossible for
# validator.key (or anything else A produced) to end up in B's directory
# by accident.
cp -r "$ENV_A/policy" "$ENV_B/policy"
cp "$ENV_A/request.json" "$ENV_B/request.json"
cp "$ENV_A/signed-result.json" "$ENV_B/signed-result.json"
cp "$ENV_A/validator.pub" "$ENV_B/validator.pub"
# The execution profile is a fifth, non-secret artifact: its own hash is
# already independently checked as part of the protocol
# (profileHash*, see docs/execution-profile-v1.md), so sharing the plain
# file itself here is no different from sharing the policy package --
# it's only needed at all because the CLI's default profile lookup is a
# compile-time-baked repo-relative path that doesn't resolve inside a
# minimal runtime container detached from the source checkout.
cp "$ENV_A/profile.json" "$ENV_B/profile.json"

if find "$ENV_B" -name 'validator.key' | grep -q .; then
  fail "Environment B's staged inputs contain a private key -- this must never happen"
fi
echo "  staged: $(find "$ENV_B" -maxdepth 1 -mindepth 1 -printf '%f ' 2>/dev/null || ls "$ENV_B")"

echo
echo "== Environment B: replay-verify (separate container, read-only mount, no private key) =="
# --rm, no --volumes-from, no shared named volume: a fresh container from
# the same image, bind-mounted read-only at ENV_B only. There is no path
# from inside this container back to ENV_A -- it was never mounted here.
set +e
REPLAY_OUTPUT=$(docker run --rm -v "$ENV_B":/work:ro "$IMAGE" \
  replay-verify --policy /work/policy --profile /work/profile.json --request /work/request.json \
  --signed-result /work/signed-result.json 2>&1)
REPLAY_EXIT=$?
set -e

echo "$REPLAY_OUTPUT"

[ "$REPLAY_EXIT" -eq 0 ] || fail "replay-verify exited $REPLAY_EXIT (expected 0)"
echo "$REPLAY_OUTPUT" | grep -q '"status": "REPLAY_OK"' || fail "replay-verify did not report REPLAY_OK"

echo
echo "TWO-ENVIRONMENT REPLAY OK: Environment B verified Environment A's signed result with no private key and no shared filesystem state."
