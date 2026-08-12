#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Proves scripts/validator-replay-two-environments.sh's isolation actually
# has teeth: each scenario below deliberately breaks exactly one thing
# about Environment B's inputs or isolation and asserts replay-verify (or
# the isolation itself) actually rejects/prevents it, rather than trusting
# that a check which has only ever seen a valid replay would also catch an
# invalid one. Matches the project's standing practice (see
# scripts/policy-reproducibility-negative-tests.sh).
#
# Reuses the same Docker image as the real script; builds it if missing.
#
# Requires scripts/build-policy.sh to have been run first so
# policies/negotiation-v1/package/ exists and is current.
set -uo pipefail
cd "$(dirname "$0")/.."

DOCKERFILE="infra/docker/validator-replay-runtime.Dockerfile"
IMAGE="ddn-validator-replay-runtime"
POLICY_DIR="policies/negotiation-v1/package"
INPUT_FIXTURE="packages/test-vectors/fixtures/negotiation-counter.json"
EXECUTION_PROFILE_ID="ddn-wasm-v1"
PROFILE_FILE="packages/config/profiles/${EXECUTION_PROFILE_ID}.json"
REQUEST_ID="req-replay-negative-test-1"

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

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not available/running; cannot run these negative tests." >&2
  exit 1
fi
if [ ! -f "$POLICY_DIR/policy.wasm" ]; then
  echo "$POLICY_DIR/policy.wasm not found; run scripts/build-policy.sh first" >&2
  exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "== No prior runtime image found; building it =="
  docker build -f "$DOCKERFILE" -t "$IMAGE" . >/dev/null
fi

# --- Set up one valid Environment A + curated Environment B inputs, reused
# as the starting point every scenario below mutates from. ---
ENV_A=$(mktemp -d)
ENV_B_TEMPLATE=$(mktemp -d)
cleanup() {
  rm -rf "$ENV_A" "$ENV_B_TEMPLATE"
}
trap cleanup EXIT

cp -r "$POLICY_DIR" "$ENV_A/policy"
cp "$INPUT_FIXTURE" "$ENV_A/input.json"
cp "$PROFILE_FILE" "$ENV_A/profile.json"
docker run --rm -v "$ENV_A":/work "$IMAGE" keygen --private-key-out /work/validator.key >/dev/null
docker run --rm -v "$ENV_A":/work "$IMAGE" \
  build-request --policy /work/policy --profile /work/profile.json --input /work/input.json \
  --request-id "$REQUEST_ID" > "$ENV_A/request.json"
docker run --rm -v "$ENV_A":/work "$IMAGE" \
  execute --policy /work/policy --profile /work/profile.json --request /work/request.json \
  --private-key-file /work/validator.key > "$ENV_A/signed-result.json"

cp -r "$ENV_A/policy" "$ENV_B_TEMPLATE/policy"
cp "$ENV_A/request.json" "$ENV_B_TEMPLATE/request.json"
cp "$ENV_A/signed-result.json" "$ENV_B_TEMPLATE/signed-result.json"
cp "$ENV_A/validator.pub" "$ENV_B_TEMPLATE/validator.pub"
cp "$ENV_A/profile.json" "$ENV_B_TEMPLATE/profile.json"

fresh_env_b() {
  local dst
  dst=$(mktemp -d)
  cp -r "$ENV_B_TEMPLATE"/. "$dst/"
  echo "$dst"
}

run_replay_verify() {
  local env_b="$1"
  docker run --rm -v "$env_b":/work:ro "$IMAGE" \
    replay-verify --policy /work/policy --profile /work/profile.json --request /work/request.json \
    --signed-result /work/signed-result.json
}

# --- 0. Sanity: the unmodified template must actually replay-verify OK,
# so every scenario below is known to be deviating from something that
# works. ---
echo
echo "== 0. Sanity: unmodified staged inputs replay-verify OK =="
env_b=$(fresh_env_b)
run_replay_verify "$env_b" >/tmp/replay-sanity.log 2>&1
exit0=$?
if [ "$exit0" -eq 0 ] && grep -q '"status": "REPLAY_OK"' /tmp/replay-sanity.log; then
  report "unmodified staged inputs replay-verify OK" true ""
else
  report "unmodified staged inputs replay-verify OK" false "exit=$exit0; see /tmp/replay-sanity.log"
fi
rm -rf "$env_b"

# --- 1. Policy package missing from the replay environment. ---
echo
echo "== 1. Policy package missing from Environment B =="
env_b=$(fresh_env_b)
rm -rf "$env_b/policy"
run_replay_verify "$env_b" >/tmp/replay-neg1.log 2>&1
exit1=$?
if [ "$exit1" -ne 0 ]; then
  report "missing policy package is rejected" true ""
else
  report "missing policy package is rejected" false "exit=$exit1 (expected non-zero); see /tmp/replay-neg1.log"
fi
rm -rf "$env_b"

# --- 2. Environment B has a same-named-but-different-hash policy. ---
echo
echo "== 2. Same-named, different-hash policy.wasm in Environment B =="
env_b=$(fresh_env_b)
python3 - "$env_b/policy/policy.wasm" <<'EOF'
import sys
path = sys.argv[1]
with open(path, "r+b") as f:
    b = bytearray(f.read())
    b[0] ^= 0x01
    f.seek(0)
    f.write(b)
EOF
run_replay_verify "$env_b" >/tmp/replay-neg2.log 2>&1
exit2=$?
if [ "$exit2" -ne 0 ] && grep -q "POLICY_HASH_MISMATCH" /tmp/replay-neg2.log; then
  report "same-named different-hash policy.wasm is rejected (POLICY_HASH_MISMATCH)" true ""
else
  report "same-named different-hash policy.wasm is rejected (POLICY_HASH_MISMATCH)" false \
    "exit=$exit2; see /tmp/replay-neg2.log"
fi
rm -rf "$env_b"

# --- 3. Private key deleted/absent before replay: this is the whole point
# of Environment B, not an edge case -- assert it structurally rather than
# by deletion (there is nothing to delete; it was never copied). ---
echo
echo "== 3. Environment B never receives a private key =="
env_b=$(fresh_env_b)
if find "$env_b" -name 'validator.key' | grep -q .; then
  report "Environment B has no private key" false "a validator.key file was found in Environment B's inputs"
else
  # Confirm replay still succeeds with no private key present anywhere.
  run_replay_verify "$env_b" >/tmp/replay-neg3.log 2>&1
  exit3=$?
  if [ "$exit3" -eq 0 ] && grep -q '"status": "REPLAY_OK"' /tmp/replay-neg3.log; then
    report "Environment B has no private key and still replay-verifies OK" true ""
  else
    report "Environment B has no private key and still replay-verifies OK" false \
      "exit=$exit3; see /tmp/replay-neg3.log"
  fi
fi
rm -rf "$env_b"

# --- 4. Environment B cannot access Environment A's files outside the
# allowed artifacts: proven structurally (separate bind mount, no
# --volumes-from, no shared volume) by asking the B container itself to
# look for A's private key at the only path it could possibly appear at
# if isolation were broken. ---
echo
echo "== 4. Environment B's container cannot see Environment A's directory =="
env_b=$(fresh_env_b)
LEAK_CHECK=$(docker run --rm -v "$env_b":/work:ro --entrypoint sh "$IMAGE" \
  -c 'find / -xdev -name "validator.key" 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]')
if [ "$LEAK_CHECK" = "0" ]; then
  report "Environment B's container has no path to Environment A's private key" true ""
else
  report "Environment B's container has no path to Environment A's private key" false \
    "found $LEAK_CHECK validator.key file(s) inside Environment B's container filesystem"
fi
rm -rf "$env_b"

echo
echo "== Negative test summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
