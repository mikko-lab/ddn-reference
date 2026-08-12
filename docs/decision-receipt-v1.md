# Decision receipt v1 (Milestone 4)

Milestone 3 proved that one validator's execution of a pinned policy
artifact can be signed and independently replay-verified. Milestone 4
proves the next thing: that **multiple separately instantiated validators**, each
executing the same pinned artifact against the same request, converge on
the same canonical result — and that agreement is captured in a
`DecisionReceiptV1` anyone can verify offline, without re-executing
`policy.wasm` and without trusting whichever party assembled the receipt.

**Important scope note.** Three same-machine subprocesses are **isolated
validator instances** — their own process, own temp directory, own
timeout, own exit code, separate stdout/stderr — not yet **independent
validator operators** on separate machines or networks. That distinction
matters and is deliberately not blurred: this repository does not claim real
distribution across machines or cloud environments. This profile proves
the *protocol* — identity, signatures, quorum, the receipt itself — works
correctly, using the simplest environment that can prove it honestly.

**Responsibility split, by design:**

- **`ddn-validator` (Rust)** remains the *only* component that executes
  policy and produces a `SignedValidatorResultV1` — unchanged from
  Milestone 3.
- **`@ddn/coordinator` (TypeScript)** spawns N isolated `ddn-validator
  execute` processes (never through a shell — see
  [No shell, ever](#no-shell-ever)) and hands their raw output to
  `@ddn/receipt-sdk`.
- **`@ddn/receipt-sdk` (TypeScript)** is a pure library: no subprocess, no
  private key, no WASM runtime. It parses, verifies identities/signatures,
  groups by consensus key, selects quorum, and assembles/verifies
  `DecisionReceiptV1`. It never decides a policy outcome and never
  executes anything.

TypeScript never makes the policy decision and never runs `policy.wasm`.
It assembles and independently verifies what the Rust validators already
signed — the correct division of trust for a coordinator.

## No shell, ever

`@ddn/coordinator` never runs a validator via a shell (`exec()` with a
command string). It uses `execFile` (equivalent to `spawn` for this
purpose — see `apps/coordinator/src/isolated-validator.ts`), which passes
an explicit argv array straight to the OS with no shell in between:

```js
execFile(validatorBinary, [
  'execute',
  '--policy', policyPackagePath,
  '--request', requestPath,
  '--private-key-file', privateKeyFilePath,
], { cwd: tempDir, timeout, killSignal: 'SIGKILL' });
```

There is no string for a request field, a file path, or anything else to
inject shell syntax into. Every isolated validator instance additionally
gets its own temp working directory, its own timeout (violating it sends
`SIGKILL`, reported back as a distinct `TIMEOUT` outcome), and separately
captured stdout/stderr — one instance's failure is fully contained and
never corrupts another's output. `--policy` is only ever *read* by
`ddn-validator execute` (never written), so sharing one pinned package
path read-only across instances is already true in practice, not just in
intent.

## The consensus key: more than `executionHash`

Validator results are grouped by a full `ConsensusKeyV1`, not by
`executionHash` alone:

```ts
interface ConsensusKeyV1 {
  policyHash: Sha256Digest;
  profileHash: Sha256Digest;
  inputHash: Sha256Digest;
  outputHash: Sha256Digest;
  executionHash: Sha256Digest;
  status: string;
}
```

`executionHash` is already a pure function of the other four hashes (see
`docs/validator-result-v1.md`), so in a correctly-implemented system these
always agree once `executionHash` does. The coordinator does not assume
that: `findExecutionHashCollisionWithDivergentKey`
(`packages/receipt-sdk/src/consensus.ts`) explicitly checks for two
results sharing an `executionHash` but disagreeing on any other field —
this should be impossible, and if it's ever observed, `selectQuorum`
returns `EXECUTION_HASH_COLLISION` and **no receipt is built**, rather
than silently picking a subgroup.

## Pre-quorum validation

Before a `SignedValidatorResultV1` may count toward quorum, every one of
these is checked (`packages/receipt-sdk/src/consensus.ts`,
`validateForQuorum`):

| Check | Rejection reason |
| --- | --- |
| Schema valid, no unknown fields | (thrown at parse time) |
| `validatorId` matches `validatorPublicKey` | `VALIDATOR_ID_MISMATCH` |
| Ed25519 signature valid | `INVALID_SIGNATURE` |
| `requestId` matches the request | `REQUEST_ID_MISMATCH` |
| `policyHash`/`profileHash`/`inputHash` match the request | `POLICY_HASH_MISMATCH` / `PROFILE_HASH_MISMATCH` / `INPUT_HASH_MISMATCH` |
| Validator belongs to the trusted `ValidatorSetV1` | `UNKNOWN_VALIDATOR` |
| Result under the size limit | `RESULT_TOO_LARGE` |
| `status` is allowed in this protocol version | `DISALLOWED_STATUS` |
| No other result from the same `validatorId` | `DUPLICATE_VALIDATOR_ID` (**both/all** copies excluded) |

A duplicate `validatorId` excludes *every* occurrence, not "keep the
first" — three copies of the same signature must never be countable as
three votes.

## Validator set

`ValidatorSetV1` is the trusted roster a coordinator checks results
against:

```ts
interface ValidatorSetV1 {
  schemaVersion: string;
  validatorSetId: Sha256Digest;
  threshold: number;
  validators: readonly { validatorId: Sha256Digest; publicKey: string; signatureAlgorithm: 'ed25519' }[];
}
```

`validatorSetId` is never accepted as free-form configuration text — it's
always derived by `computeValidatorSetId`/`buildValidatorSetV1`
(`packages/receipt-sdk/src/validator-set.ts`) from a domain-separated
canonical envelope over the set's own content (`schemaVersion`,
`threshold`, its members, sorted by `validatorId`), excluding
`validatorSetId` itself:

```json
{ "domain": "DDN_VALIDATOR_SET_V1", "schemaVersion": "1.0.0", "threshold": 2, "validators": [...] }
```

`ddn-coordinator build-validator-set` builds one from a list of public-key
files; every command that loads a `ValidatorSetV1` from disk
(`decide`/`verify-receipt`) independently recomputes its id and refuses to
proceed if it doesn't match — the same "never trust a self-declared hash"
rule the Rust validator applies to `manifestHash`/`policyHash`.

## DecisionReceiptV1

```ts
interface DecisionReceiptV1 {
  schemaVersion: '1.0.0';
  receiptId: Sha256Digest;
  request: ExecutionRequestV1;
  quorum: {
    validatorSetId: Sha256Digest;
    threshold: number;
    totalValidators: number;
    agreeingValidatorIds: readonly string[]; // sorted ascending
  };
  consensus: ConsensusKeyV1;
  signedResults: readonly SignedValidatorResultV1[]; // sorted ascending by result.validatorId
}
```

`receiptId` is computed the same way as `validatorId`
(`docs/validator-result-v1.md`) and `validatorSetId` above — a flat,
domain-separated canonical envelope, not the `{ domain, value }` wrapper
`hashCanonicalJson` uses elsewhere:

```json
{ "domain": "DDN_DECISION_RECEIPT_V1", "request": {...}, "quorum": {...}, "consensus": {...}, "signedResults": [...] }
```

`signedResults` and `quorum.agreeingValidatorIds` are sorted by
`validatorId` before hashing — deterministic regardless of the order
validator processes happened to finish in. A `DecisionReceiptV1` is only
ever built when quorum was actually reached
(`buildDecisionReceipt` throws otherwise); when it isn't, the coordinator
emits a `CoordinatorFailureV1` instead — diagnostic, never a substitute
proof of agreement:

```ts
interface CoordinatorFailureV1 {
  schemaVersion: '1.0.0';
  requestId: string;
  reason: 'NO_QUORUM' | 'EXECUTION_HASH_COLLISION';
  groups: readonly { key: ConsensusKeyV1; validatorIds: readonly string[] }[];
  rejected: readonly { validatorId: string; reason: RejectedResultReason }[];
}
```

**No timestamp anywhere in this milestone.** Useful for a database row
later, but timestamps have a reliable ability to ruin canonical test
vectors, and nothing about "did these validators agree" depends on when
they did.

## Quorum scenarios

`packages/receipt-sdk/src/index.test.ts` proves every one of these
(fixed synthetic keypairs, not production keys):

| Scenario | Outcome |
| --- | --- |
| 3 identical results | `QUORUM_REACHED`, 3/3 |
| 2 identical + 1 different | `QUORUM_REACHED`, 2/3 |
| 2 identical + 1 missing (timeout) | `QUORUM_REACHED`, 2/3 |
| 1 result + 2 different | `NO_QUORUM` |
| 1 result + 2 missing (timeouts) | `NO_QUORUM` |
| 3 different results | `NO_QUORUM` |
| Duplicate `validatorId` | both/all copies excluded (`DUPLICATE_VALIDATOR_ID`), never counted as extra votes |
| Wrong/tampered signature | excluded, does not participate in quorum |
| Unknown validator (not in the set) | excluded, does not participate in quorum |

## CLI (`ddn-coordinator`)

```bash
# Build a trusted ValidatorSetV1 from three public keys (ddn-validator
# keygen's .pub output). validatorSetId is always derived, never supplied.
ddn-coordinator build-validator-set \
  --public-key-file a.pub --public-key-file b.pub --public-key-file c.pub \
  --threshold 2 \
  > validator-set.json

# Build a request, run it through three isolated ddn-validator instances,
# check quorum, and emit a DecisionReceiptV1 (exit 0) or a
# CoordinatorFailureV1 (exit 1).
ddn-coordinator decide \
  --validator-bin ./target/release/ddn-validator \
  --policy policies/negotiation-v1/package \
  --request request.json \
  --validator-set validator-set.json \
  --private-key-file a.key --public-key-file a.pub \
  --private-key-file b.key --public-key-file b.pub \
  --private-key-file c.key --public-key-file c.pub \
  --timeout-ms 30000 \
  > decide-output.json

# Fully offline verification: schema, validator set integrity, every
# contributing signature/identity, request bindings, consensus agreement,
# quorum threshold, deterministic ordering, and receiptId. Never re-runs
# policy.wasm -- see "What verify-receipt does not do" below.
ddn-coordinator verify-receipt \
  --validator-set validator-set.json \
  --receipt decision-receipt.json
```

## What `verify-receipt` actually checks

Every check runs (not short-circuited on the first failure);
`RECEIPT_OK` requires all of them (`packages/receipt-sdk/src/decision-receipt.ts`,
`verifyDecisionReceipt`):

| Check | What it catches if it fails |
| --- | --- |
| `schemaValid` | malformed receipt, or an unrecognized field anywhere in it |
| `validatorSetIdMatchesItsOwnContent` | the validator set handed to this command was tampered with |
| `receiptValidatorSetIdMatchesGivenSet` | the receipt was built against a *different* validator set |
| `receiptThresholdMatchesValidatorSet` / `receiptTotalValidatorsMatchesSet` | the receipt claims a weaker quorum rule than the trusted set actually requires |
| `agreeingValidatorIdsAreSorted` / `signedResultsAreSortedByValidatorId` | the receipt's deterministic-ordering guarantee was violated |
| `everyContributingValidatorIdMatchesPublicKey` | a stale/mismatched identity among the contributing results |
| `everyContributingSignatureValid` | any contributing signature was tampered with |
| `everyContributingResultBoundToRequest` | a contributing result doesn't actually belong to this request |
| `everyContributingValidatorInSet` | a contributing validator isn't in the trusted set |
| `noDuplicateContributingValidatorIds` | the same validator counted more than once |
| `allSignedResultsShareReceiptConsensus` | a contributing result doesn't match the receipt's own claimed consensus |
| `agreeingValidatorIdsMatchSignedResults` | the id list and the actual signed results disagree |
| `quorumThresholdReached` | fewer contributing results than the threshold requires |
| `receiptIdMatchesContent` | the receipt itself was tampered with |

### What `verify-receipt` does not do

It never re-executes `policy.wasm` — that's Milestone 3's
`ddn-validator replay-verify` job, already proven independently. A later,
combined command can chain "verify receipt → replay one or all
contributing results"; kept as separate responsibilities here on purpose,
so `@ddn/receipt-sdk` stays a small, dependency-light library instead of
also growing a WASM runtime and a process-management layer of its own.

## Golden protocol vectors

`packages/test-vectors/vectors/decision-receipt-v1/` is a fixed, committed
set of artifacts generated from three FIXED synthetic Ed25519 keypairs
(never randomly generated) and the real, pinned `ddn-validator` binary:
`validator-set.json`, `signed-result-validator-{a,b,c}.json`,
`decision-receipt.json`, plus their exact canonical forms and derived ids
as plain text: `canonical-validator-set.txt`, `canonical-receipt.txt`,
`validator-set-id.txt`, `receipt-id.txt`.

`packages/receipt-sdk/src/golden-vectors.test.ts` loads these *committed*
files and compares them against what this library recomputes right now —
canonical JSON bytes, `validatorSetId`, `receiptId`, and full offline
verification of the Rust-produced signatures with **zero transformation**.
Nothing is generated and then compared to itself; a single flipped byte
anywhere in the committed set makes the corresponding check fail.

The vectors are only ever rewritten by hand, deliberately:

```bash
ddn-coordinator generate-golden-vectors \
  --validator-bin ./target/release/ddn-validator \
  --policy policies/negotiation-v1/package \
  --input packages/test-vectors/fixtures/negotiation-counter.json \
  --out-dir packages/test-vectors/vectors/decision-receipt-v1 \
  --confirm-update
```

`--confirm-update` is required — there is no argument-less shorthand —
and this command is never invoked by CI.

## Milestone 4 acceptance chain

```
ExecutionRequestV1
  -> three separate, real Rust ddn-validator processes (isolated instances)
  -> three SignedValidatorResultV1s
  -> TypeScript checks identities and signatures (@ddn/receipt-sdk)
  -> 2/3 quorum over the full ConsensusKeyV1
  -> canonical DecisionReceiptV1
  -> offline verification via @ddn/receipt-sdk
```

Proven directly, with real subprocesses (not mocks):
`apps/coordinator/src/decide.test.ts` runs three genuine `ddn-validator
execute` processes against the real, pinned policy package, reaches
3/3 quorum, and fully offline-verifies the resulting receipt — and a
second test corrupts one instance's own private key file and confirms the
other two real instances still reach the 2/3 threshold.

## Known limitations

- Same-machine subprocesses only — see the scope note at the top. Real
  multi-machine or multi-cloud distribution is outside the stated claims.
- No coordinator persistence, HTTP API, job queue, or state machine yet —
  `ddn-coordinator decide` is a synchronous CLI command, not a service.
- No dispute/appeal process for a `NO_QUORUM`/`EXECUTION_HASH_COLLISION`
  outcome beyond the diagnostic `CoordinatorFailureV1` — deciding what
  happens next (retry, escalation or alerting) is operationally out of scope.
- `verify-receipt` trusts whatever `ValidatorSetV1` it's given (after
  checking its internal consistency) — establishing *which* validator set
  is authoritative for a given policy/tenant is not yet solved here.
