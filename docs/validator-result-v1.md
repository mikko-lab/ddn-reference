# Validator result v1 (Milestone 3)

Milestone 2 proved that a specific `policy.wasm` artifact can be rebuilt
byte-for-byte from source. Milestone 3 proves the next thing: that one
validator's execution of that artifact against a specific input can be
signed and independently replayed — by anyone, offline, without trusting
the validator that produced it.

**Scope.** This is a single validator signing a single execution. No
coordinator, no quorum, no validator network, no database, no Merkle
anchoring, no HTTP API — those are separate components described in
`docs/public-project-description.md`. Deliberately: one validator is hardened all the
way through before any of it is multiplied into a quorum, since a quorum
of three broken validators is just a distributed error.

**Hardening (this delivery).** Four things had to be true before this
single validator was considered done, each with its own negative tests
proving the check actually rejects what it claims to:

1. [Policy package pinning](#policy-package-pinning) — every hash a
   policy package's manifest declares is recomputed from the actual files
   on disk, never trusted from the manifest or a request's claim.
2. [Validator key identity](#validator-key-identity) — `validatorId` is
   derived from an Ed25519 public key, never a free-form value a request
   or CLI flag can assert.
3. [Golden protocol vectors](#golden-protocol-vectors) — a committed,
   byte-for-byte fixture proving canonical JSON, every hash, the
   validator identity, the signature envelope, and the Ed25519 signature
   itself never silently drift.
4. [Two clean-environment replay](#two-clean-environment-replay) — the
   whole chain, proven end to end in a second, genuinely separate
   environment holding no private key.

The chain this delivery proves, start to finish: a pinned policy package
→ its self-computed identity (`manifestHash`, recomputed, never trusted)
→ a validator identity derived from its own public key → a canonically
signed result → vectors of all of that committed to git → replayed
successfully in a second clean environment → `REPLAY_OK`, with no private
key in sight.

## The three schemas

`packages/schemas/json/execution-request-v1.schema.json`,
`validator-result-v1.schema.json`, `signed-validator-result-v1.schema.json`
are the source of truth; `apps/validator/src/protocol.rs` implements them
in Rust (`#[serde(deny_unknown_fields)]`, so an unrecognized field is a
parse error, not a silently-ignored one).

### `ExecutionRequestV1`

A request to execute a specific pinned policy artifact against a specific
input.

```json
{
  "schemaVersion": "1.0.0",
  "requestId": "req-...",
  "policyId": "negotiation-reference",
  "policyVersion": "1.0.0",
  "policyHash": "sha256:...",
  "profileHash": "sha256:...",
  "manifestHash": "sha256:...",
  "input": { "...": "NegotiationInputV1, or any policy's own input shape" },
  "inputHash": "sha256:..."
}
```

`policyHash`/`profileHash`/`manifestHash`/`inputHash` are the **requester's
claims**, not trusted facts. `build_signed_result` (the `execute` CLI
command) recomputes each one independently — from the actual loaded
`policy.wasm`/manifest, the actual loaded execution profile, and the
actual canonicalized `input` — and rejects the request before running
anything if any claim doesn't match reality. A request that lies about
its own inputs never reaches the policy. See
[Policy package pinning](#policy-package-pinning) below for what
`manifestHash` covers and why it's a separate claim from `policyHash`.

### `ValidatorResultV1`

```json
{
  "schemaVersion": "1.0.0",
  "requestId": "req-...",
  "validatorId": "sha256:...",
  "policyHash": "sha256:...",
  "profileHash": "sha256:...",
  "manifestHash": "sha256:...",
  "inputHash": "sha256:...",
  "output": { "...": "the policy's canonical output" },
  "outputHash": "sha256:...",
  "executionHash": "sha256:...",
  "status": "SUCCESS"
}
```

**Deliberately excludes a timestamp, a nonce, the validator's name/hostname,
or any runtime metadata.** `executionHash` (computed in `execute_text`,
`apps/validator/src/lib.rs` — unchanged since Milestone 2) is
`sha256(canonicalize({ domain: "DDN_EXECUTION_V1", inputHash, policyHash,
profileHash, outputHash }))` — a pure function of the other four hashes.
Two validators executing the same request against the same pinned artifact
produce the identical `executionHash`, not just an equivalent one. Adding
a timestamp or a validator identifier into that computation would make
"the same execution" depend on *when* or *who* ran it — exactly the
determinism Milestone 2 spent its effort proving, undone by the next layer
up. `validatorId` and `status` are recorded in `ValidatorResultV1` for
audit purposes, but neither feeds `executionHash`.

### `SignedValidatorResultV1`

```json
{
  "result": { "...": "ValidatorResultV1" },
  "validatorPublicKey": "<64 lowercase hex chars>",
  "signatureAlgorithm": "ed25519",
  "signature": "<128 lowercase hex chars>"
}
```

The signature is computed over the canonical JSON bytes of the
domain-separated envelope `{ "domain": "DDN_VALIDATOR_RESULT_V1", "value":
result }` — the same domain-separation convention `hash_canonical_json`
uses elsewhere in this codebase (`DDN_INPUT_V1`, `DDN_OUTPUT_V1`,
`DDN_EXECUTION_V1`, `DDN_PROFILE_V1`), applied to signing instead of
hashing. `validatorPublicKey` is derived from the signing key itself when
the result is built (`public_key_from_private_key`), never taken as a
caller-supplied claim — there is no way to sign a result and assert a
different public key for it.

## Validator key identity

`validatorId` is not a free-form label — it is derived, deterministically,
from an Ed25519 public key (`apps/validator/src/identity.rs`):

```
validatorId = sha256(canonicalize({
  "domain": "DDN_VALIDATOR_ID_V1",
  "signatureAlgorithm": "ed25519",
  "publicKey": "<64 lowercase hex chars>"
}))
```

Note this envelope is flat (`domain` alongside the other fields), a
deliberately different shape from the `{ domain, value }` two-level
wrapper `hash_canonical_json` uses elsewhere — a narrower convention for
this one identity statement, pinned exactly by the golden vectors in
`packages/test-vectors/vectors/validator-protocol-v1/`.

There is no code path — request field, CLI flag, or otherwise — that lets
a caller assert a `validatorId` for a key it doesn't hold:
`sign_validator_result` unconditionally overwrites whatever `validatorId`
was set on the `ValidatorResultV1` it's given with
`derive_validator_id(public_key_from_private_key(the actual signing key))`
before computing the signature. `replay-verify` re-derives the expected
`validatorId` from `signed.validatorPublicKey` and checks it against
`signed.result.validatorId` (`validatorIdMatchesPublicKey`) — a signed
result whose embedded public key doesn't match its own `validatorId`
fails replay even if the signature bytes still happen to verify against
some other key.

```bash
# Print the validatorId for a public key -- no private key needed or read.
ddn-validator inspect-key --public-key validator.pub
```

```json
{
  "signatureAlgorithm": "ed25519",
  "publicKey": "<64 lowercase hex chars>",
  "validatorId": "sha256:..."
}
```

**Key file handling.** `ddn-validator keygen` writes the private key
(`--private-key-out`) and, alongside it, the public key to the same path
with a `.pub` extension. On Unix, the private key file is set to
owner-only (`0600`) immediately after writing, and `execute`/anything
else that reads a private key file refuses to proceed if its permission
bits allow group or other access — there is no way to recover a key that
a permissive mode may have already exposed, but the validator will not
compound that by signing with a key it can tell has been left readable.
The private key is never written into a `ValidatorResultV1`,
`SignedValidatorResultV1`, log line, or test fixture — tests use a fixed,
published, synthetic test-vector key
(`packages/test-vectors/vectors/crypto-v1.json`), never a real validator
key.

## Policy package pinning

The validator accepts only a whole, internally consistent policy package
— see `apps/validator/src/package.rs` and
`packages/schemas/json/policy-manifest-v1.schema.json`. Before executing
anything, `load_policy` recomputes, from the actual files on disk, every
hash `manifest.json` declares:

- `policy.wasm` → `wasmHash`
- `input.schema.json` → `inputSchemaHash`
- `output.schema.json` → `outputSchemaHash`
- `reason-codes.json` → `reasonCodeRegistryHash`
- `test-vectors.json` → `testVectorHash`

and computes `manifestHash` — the canonical hash of `manifest.json` itself
with `createdAt` removed (that field is expected to vary between
otherwise-identical builds; see `docs/reproducible-builds.md`, and must
not affect a hash meant to identify one fixed package). `manifest.json`
itself is parsed with `#[serde(deny_unknown_fields)]`: an unrecognized
field makes the whole package untrustworthy, the same policy already
applied to the three protocol schemas above.

`ExecutionRequestV1`'s `policyHash`/`profileHash`/`manifestHash` are then
checked against these independently-recomputed values, never against each
other or against what the manifest merely claims about itself. Every
failure fails closed with one of five specific codes (prefixed onto the
error message returned from `load_policy`/`build_signed_result`, and
available as `PolicyPackageError::code()` for direct callers):

| Code | Meaning |
| --- | --- |
| `POLICY_PACKAGE_INVALID` | `manifest.json` doesn't parse, is missing a required field, carries an unrecognized one, or a file it references is missing/unreadable |
| `POLICY_HASH_MISMATCH` | `policy.wasm`'s actual hash doesn't match the manifest's declared `wasmHash`, or a request's `policyHash` claim doesn't match the validator's own value |
| `PROFILE_HASH_MISMATCH` | a request's `profileHash` claim doesn't match the actual, independently-recomputed execution profile hash |
| `SCHEMA_HASH_MISMATCH` | `input.schema.json`/`output.schema.json`/`reason-codes.json`/`test-vectors.json`'s actual hash doesn't match what the manifest declares |
| `MANIFEST_HASH_MISMATCH` | a request's `manifestHash` claim doesn't match the manifest's own independently-recomputed canonical hash |

## Golden protocol vectors

`packages/test-vectors/vectors/validator-protocol-v1/` is a fixed, committed
set of artifacts proving the whole protocol byte-for-byte:
`execution-request.json`, `validator-result.json`,
`signed-validator-result.json` (human-readable, pretty-printed), plus
their exact canonical forms and every derived value as plain text:
`canonical-request.txt`, `canonical-result.txt`,
`canonical-signature-envelope.txt`, `input-hash.txt`, `output-hash.txt`,
`execution-hash.txt`, `validator-id.txt`, `public-key.txt`,
`signature.txt`.

Everything is generated from the fixed synthetic test key in
`packages/test-vectors/vectors/crypto-v1.json` and a fixed `requestId`
(`req-golden-vector-1`) — never a randomly generated key or a
clock/UUID — against whatever policy package is passed in, so
regenerating the set from the same (reproducible, per Milestone 2)
policy package always produces byte-identical output.

`apps/validator/tests/golden_vectors.rs` is the point of this: it loads
the *committed* files and compares them against what
`apps/validator/src/golden_vectors.rs`/`protocol.rs` recompute right now
— canonical JSON bytes, every hash, `validatorId`, the exact envelope
that gets signed, and the Ed25519 signature itself, verified against the
committed public key. Nothing is generated and then compared to itself;
a single flipped byte anywhere in the committed set makes the
corresponding check fail (see the last two tests in that file).

**These committed hashes are pinned to one specific `policy.wasm` build:**
the release-locked `linux/arm64` artifact `scripts/policy-reproducibility.sh`
produces (see `docs/reproducible-builds.md#reproducibility-is-per-architecture`
— policy.wasm's bytes are genuinely architecture-dependent, so a hash
pinned to one architecture's build cannot match another's). CI runs
`golden_vectors.rs` only in the `reproducibility-arm64` job, immediately
after that script re-verifies and rebuilds the release package — never in
the generic `wasm` job, whose own `scripts/build-policy.sh` step is a
plain, non-pinned build on whatever architecture that job's runner
happens to be (currently amd64), which legitimately produces different
`policy.wasm` bytes and would fail this comparison for reasons that have
nothing to do with the protocol code being wrong.

The vectors are only ever rewritten by hand, deliberately:

```bash
ddn-validator generate-golden-vectors \
  --policy policies/negotiation-v1/package \
  --input packages/test-vectors/fixtures/negotiation-counter.json \
  --out-dir packages/test-vectors/vectors/validator-protocol-v1 \
  --confirm-update
```

`--confirm-update` is required — there is no argument-less shorthand —
and this command is never invoked by CI. The vectors are a reviewed,
committed artifact that tests check *against*; regenerating them is a
deliberate, reviewed act, not a build step.

## CLI (`ddn-validator`)

Six new subcommands, on top of Milestone 1-2's `run`/`determinism-check`:

```bash
# Generate a validator keypair. The private key is written to a file, not
# printed — see the project's standing rule against secrets in shell
# history or process listings. Also writes the public key alongside it
# (validator.key -> validator.pub).
ddn-validator keygen --private-key-out validator.key

# Print the validatorId derived from a public key -- no private key
# needed. See "Validator key identity" above.
ddn-validator inspect-key --public-key validator.pub

# Build an ExecutionRequestV1 for a raw input, deriving
# policyHash/profileHash/manifestHash/inputHash from the actual loaded
# policy package rather than requiring the caller to compute them by hand.
ddn-validator build-request \
  --policy policies/negotiation-v1/package \
  --input input.json \
  --request-id req-... \
  > request.json

# Execute a request, independently verifying its hash claims, and print a
# signed result. validatorId is derived from the signing key itself, not
# passed on the command line.
ddn-validator execute \
  --policy policies/negotiation-v1/package \
  --request request.json \
  --private-key-file validator.key \
  > signed-result.json

# Independently replay-verify a signed result: verify the signature,
# recompute every hash from the original request and a local policy
# package, and re-run policy.wasm. Trusts nothing about signed-result.json
# except that it parses. Exits 0 only if every check passes.
ddn-validator replay-verify \
  --policy policies/negotiation-v1/package \
  --request request.json \
  --signed-result signed-result.json
```

`replay-verify` needs no state from the validator that produced the
signed result — no private key, no validator process, nothing but the
policy package (public), the original request (public), and the signed
result (public). Confirmed directly: running it from a fresh directory
containing only those three things, after deleting the private key
entirely, still returns `REPLAY_OK` / exit 0.

## Two clean-environment replay

The claim above ("no state from the validator that produced it") is
checked for real, not just asserted, by
`scripts/validator-replay-two-environments.sh` — a blocking step in CI's
`wasm` job. It builds `infra/docker/validator-replay-runtime.Dockerfile`
once, then runs two genuinely separate containers from that image:

- **Environment A** (`docker run`, bind-mounted at its own host temp
  directory): generates a keypair, runs `build-request` +
  `execute`, and ends up holding five things — the policy package, the
  (non-secret) execution profile, the request, the signed result, and,
  only here, the private key.
- **Environment B** (a *different* `docker run`, from the same image,
  bind-mounted **read-only** at a separately hand-curated host directory
  containing only copies of the policy package, execution profile,
  request, signed result, and public key — never Environment A's private
  key, never Environment A's directory at all): runs `replay-verify` and
  must print `REPLAY_OK` with exit code 0.

There is no `--volumes-from`, no shared named volume, and no path from
inside Environment B's container back to Environment A's directory — two
independent `--rm` containers, each with its own bind mount. This is
enforced structurally (Environment B's inputs are assembled by copying
named files one at a time, never the whole of Environment A's directory),
and checked directly by
`scripts/validator-replay-negative-tests.sh`, which also proves: a
missing policy package in Environment B is rejected; a same-named but
different-hash `policy.wasm` in Environment B is rejected
(`POLICY_HASH_MISMATCH`); Environment B never receives a private key and
still replay-verifies successfully; and a `find` run *inside* Environment
B's own container turns up zero paths named `validator.key` anywhere it
can see.

## What `replay-verify` actually checks

Every check runs (not short-circuited on the first failure), so a caller
sees the full picture; `REPLAY_OK` requires all of them:

| Check | What it catches if it fails |
| --- | --- |
| `signatureValid` | broken signature, or a public key that doesn't match the actual signer |
| `validatorIdMatchesPublicKey` | `signed.result.validatorId` doesn't match `derive_validator_id(signed.validatorPublicKey)` — a stale or mismatched identity, independent of whether the signature itself still verifies |
| `requestIdMatches` | the signed result doesn't correspond to this request |
| `policyHashMatchesLoadedPolicy` | the signed result was produced against a different `policy.wasm` than the one on disk here |
| `policyHashMatchesRequestClaim` | the request's own `policyHash` claim doesn't match what was actually signed |
| `profileHashMatchesLoadedProfile` / `profileHashMatchesRequestClaim` | same, for the execution profile |
| `manifestHashMatchesLoadedManifest` / `manifestHashMatchesRequestClaim` | same, for the policy package's manifest |
| `inputHashMatchesRecomputedInput` | the request's `input` doesn't hash to what the signed result claims |
| `inputHashMatchesRequestClaim` | the request's own `inputHash` field is inconsistent with its own `input` |
| `outputMatches` / `outputHashMatches` | the recorded output was tampered with after the policy ran |
| `executionHashMatches` | `executionHash` was tampered with directly |

## Negative tests

`apps/validator/tests/golden_vectors.rs` — 8 tests proving the committed
golden vectors match live recomputation and that tampering with any one
of them is actually caught (see
[Golden protocol vectors](#golden-protocol-vectors) above).

`apps/validator/tests/protocol_negative_tests.rs` — 23 tests, each
mutating exactly one thing and asserting the specific check (or error
code) that should catch it actually fails, matching the project's
standing practice (see `scripts/policy-reproducibility-negative-tests.sh`)
of proving a check has teeth rather than just existing:

- changed input (stale `inputHash` left in place)
- wrong `inputHash` (input left alone)
- changed `policy.wasm` / `input.schema.json` / `output.schema.json` /
  `reason-codes.json` (each independently caught by `load_policy`'s
  pinning checks — `POLICY_HASH_MISMATCH` / `SCHEMA_HASH_MISMATCH`)
- a manifest field changed with no corresponding file hash to catch it
  (still changes `manifestHash`, by design)
- wrong `policyHash` / `profileHash` / `manifestHash` claim
- a request that's internally consistent and correctly matches what the
  policy was *originally* pinned to, but no longer matches a *local
  artifact* that has since changed (`PROFILE_HASH_MISMATCH`)
- changed output / wrong `outputHash` / wrong `executionHash`
- wrong public key / broken signature
- `validatorId` not matching the embedded public key, checked in
  isolation from `signatureValid` (`validatorIdMatchesPublicKey`)
- unknown `schemaVersion` (on both `ExecutionRequestV1` and
  `SignedValidatorResultV1`)
- an extra, unrecognized field (on both, `deny_unknown_fields`)

## Known limitations

- `ddn-validator execute`/`replay-verify` are CLI commands run by hand or
  by scripts, not a service — no HTTP API, persistence or concurrent request
  handling is claimed.
- A single validator's signature is the entire trust model here. Nothing
  in this milestone establishes *which* validators are authorized, quorum
  agreement across multiple validators, or on-chain/Merkle anchoring of
  results — all explicitly out of scope per the build plan for this
  delivery.
- `validatorId` is derived from a validator's own Ed25519 public key
  (see [Validator key identity](#validator-key-identity)), but there is
  no registry of *authorized* validator identities — any key can derive and
  sign as itself. Trust-set selection is explicitly outside this component.
