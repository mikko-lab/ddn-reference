# API security model (Milestone 5)

This document is the normative source `apps/api`'s own code comments
point to (`api-error.ts`, `error-handler.ts`, `config.ts`,
`process-decision.ts`) when they say "never log/return" or "see
docs/api-security-model.md." It was written after the fact, describing
what is actually implemented and verified in this repository -- not a
design aspiration. Where a claim below is narrower than it might sound,
that narrowing is deliberate; see "What this does not claim" at the end.

## Trust boundaries

```
external client  --HTTP + Bearer token-->  apps/api  --execFile-->  ddn-validator (isolated instance)
       ^                                        |
       |                                        v
       +----- must verify locally, never ----- DecisionReceiptV1
              trust the "FINALIZED" claim
```

- **External client ↔ `apps/api`**: authenticated with a service token
  (`Authorization: Bearer <token>`), never a user session. The API's own
  claim that a decision is `FINALIZED` is not the client's proof --
  `@ddn/client-sdk`'s `submitWaitAndVerify` (and any other conformant
  client) fetches the raw `DecisionReceiptV1` and independently verifies
  it with `@ddn/receipt-sdk` before accepting the result. See
  `docs/api-v1.md`'s "external-client trust model" section.
- **`apps/api` ↔ isolated validator instances**: `apps/api` holds each
  instance's private key **file path**, never the key bytes. The key is
  read only by that instance's own `ddn-validator execute` child process
  (`apps/api/src/decisions/decision-runner.ts`, via `@ddn/coordinator`'s
  `decide()`), spawned with `execFile` -- an explicit argv array, never a
  shell string, so there is no command-injection surface. This is the
  same "three isolated validator instances" model `docs/decision-receipt-v1.md`
  established in Milestone 4: separate process, separate temp directory,
  separate timeout (violating it sends `SIGKILL`), separate captured
  stdout/stderr. They are not separate machines or operators; independent
  operator distribution is outside this reference implementation's claims.
- **`apps/api` ↔ its own configured `ValidatorSetV1`**: loaded fresh from
  `DDN_VALIDATOR_SET_PATH` and never trusted on its own word --
  `loadTrustedValidatorSet` (`apps/api/src/policies/validator-set-loader.ts`)
  recomputes `validatorSetId` from the file's own content and refuses to
  use the file if the two disagree, before it is used for anything.

## Tenant isolation

A service token resolves to exactly one `tenantId`
(`ServiceTokenPrincipal`, `apps/api/src/auth/`). `POST /v1/decisions`
reconciles `input.tenantId` against it (`apps/api/src/auth/tenant-context.ts`)
**before** the stricter `negotiation-input-v1.schema.json` check runs:
absent → injected from the principal; present and mismatched → `403
TENANT_MISMATCH`. Idempotency keys are always namespaced by
`principal.tenantId`, never by anything the client supplies directly, so
two tenants can never collide on the same idempotency hash.

`GET /v1/decisions/{id}` and its `/receipt` sibling report a decision
belonging to a different tenant identically to one that does not exist
(`404 DECISION_NOT_FOUND`, never `403`) -- a client must never be able to
confirm that some other tenant's `decisionId` is valid.

Policy metadata (`GET /v1/policies`, its detail endpoint) is
deliberately **not** tenant-scoped: policy hashes, schemas, and reason
codes are the same for every tenant and carry no tenant-specific data.

## Fail-closed principles

- **Receipt self-verification gate** (`decision-runner.ts`'s
  `assembleOutcomeFromReceipt`): a decision only reaches `FINALIZED` if
  `apps/api`'s own call to `@ddn/receipt-sdk`'s `verifyDecisionReceipt`
  -- against its own independently-loaded, self-checked `ValidatorSetV1`
  -- returns `ok: true`. A receipt `@ddn/coordinator` itself just
  assembled but that fails this check resolves to `FAILED` with code
  `RECEIPT_SELF_VERIFICATION_FAILED`, never `FINALIZED`. Tested directly
  (not just by code inspection): `decision-runner.test.ts` forces this
  gate to actually fail using a real, validly-signed golden-vector
  receipt against a deliberately mismatched validator set.
- **No decision is ever left stuck in `RUNNING`**
  (`process-decision.ts`'s `failDecision`): any exception anywhere in
  decision processing -- including the self-verification gate above --
  resolves the decision to a terminal `FAILED` state.
- **`NO_QUORUM` and `EXECUTION_HASH_COLLISION` both fail closed**
  (`decision-runner.ts`'s `mapCoordinatorFailure`): neither ever produces
  a receipt. They are reported as distinct decision states/codes rather
  than collapsed into one, since "not enough validators responded" and
  "validators disagreed on identical input" call for different operator
  responses.
- **The state machine itself** (`apps/api/src/decisions/types.ts`'s
  `ALLOWED_DECISION_TRANSITIONS`): `FINALIZED`/`NO_QUORUM`/`FAILED` are
  terminal, enforced by compare-and-set
  (`decision-repository.ts`'s `transition()`) -- there is no code path
  that transitions a decision back out of a terminal state.

## What a client response may contain vs. what a server log may contain

Every non-2xx HTTP response is `ApiErrorResponseV1`:
`{schemaVersion, error: {code, message, requestId, details?}}`
(`apps/api/src/errors/api-error.ts`). The same shape backs a decision's
`error` field for `NO_QUORUM`/`FAILED`. In both cases:

- **`message` is always a deliberately hand-written string** -- either
  one of `ApiError`'s own call sites (grep `new ApiError(` under
  `apps/api/src` for the exhaustive list; every one is a short, static or
  client-identifier-echoing string, never a raw exception message), or,
  for anything else, a fixed generic string
  (`process-decision.ts`'s `GENERIC_FAILURE_MESSAGE`,
  `error-handler.ts`'s `'an unexpected error occurred'`).
- **Never included in a client-visible `message`/`details`**: stack
  traces, file paths (validator binary path, policy package path,
  validator-set path, private/public key file paths, temp directory
  paths), raw `fs`/subprocess exception text, validator process stderr,
  bearer tokens, or the raw JSON body of a submitted `input` (decision
  responses return only the policy's `result`, never the original
  `input` back -- see `response-mapping.ts`).
- **Server logs may contain more than client responses do**: an
  unexpected (non-`ApiError`) exception is logged in full --
  `req.log.error({err: error, ...})` in `error-handler.ts` for
  synchronous request failures, `console.error(..., error)` in
  `process-decision.ts` for background decision failures -- since these
  are operator-facing, not client-facing. For the **validator** key
  boundary this is safe unconditionally: `apps/api` never reads a
  validator private key's bytes into memory (only file *paths*, passed
  as `execFile` arguments), so there is no validator key material for a
  full exception dump to accidentally contain, regardless of what
  triggered it. The Milestone 6 anchor submitter key is a narrower,
  explicitly scoped exception to this -- see "Key and validator-process
  boundaries" below.
- **One deliberate exception, not a leak**: `GET
  /v1/decisions/{id}/receipt` returns the raw `DecisionReceiptV1`, which
  embeds the original `input` (`ExecutionRequestV1.input` -- required
  for the input hash to be independently verifiable). This is available
  only to the tenant that submitted it (same tenant-isolation rule as
  above) and only once `FINALIZED` -- the client already possesses its
  own input, so this is not a disclosure to any other party.

## Key and validator-process boundaries

- **Validator keys**: `apps/api` never has a validator private key's raw
  bytes in its own process memory at any point. It reads only
  `DDN_VALIDATOR_INSTANCES`' file *paths* and each instance's *public*
  key file content (to compute `publicKeyHex` for `@ddn/coordinator`'s
  `decide()`); the private key file is opened and read exclusively by
  the corresponding `ddn-validator execute` child process.
- **Milestone 6 anchor submitter key -- a deliberate, narrower
  exception, not an extension of the claim above**: `apps/api`'s
  in-process `@ddn/anchor-service` worker *does* load
  `DDN_ANCHOR_SUBMITTER_PRIVATE_KEY`'s raw bytes into `apps/api`'s own
  process memory (`viem`'s `privateKeyToAccount`, constructed directly
  in `server.ts`), since it signs the on-chain `anchorBatch` transaction
  itself rather than delegating to a separate signing process the way
  validator execution does. This is acceptable *only* under Milestone
  6's own explicit scope -- a local Anvil chain, no production
  deployment (see `docs/anchor-v1.md`) -- and is not the intended
  production key-management model. Two things follow from this key
  actually living in process memory, unlike a validator key:
  - `chain-client.ts` wraps `privateKeyToAccount` in a try/catch that
    reduces any thrown error to a fixed, generic message containing
    neither the key nor the original error object, specifically because
    this process's own "server logs may contain more than client
    responses do" discipline above would otherwise risk printing the
    key itself if `viem` ever embeds invalid input in its own error
    text.
  - A real production anchor deployment must move key custody out of
    `apps/api`'s process entirely (a KMS/HSM-backed signer, or a
    genuinely separate signing service) rather than an env-var-supplied
    raw key. Production key custody and the rest of the durable,
    multi-instance anchor-service work are explicitly out of scope, as noted in
    `docs/anchor-v1.md`'s "Known limitations".
- Constant-time token comparison (`apps/api/src/auth/token-registry.ts`):
  every configured service token is compared via a fixed-length SHA-256
  fingerprint and `crypto.timingSafeEqual`, scanning the full list rather
  than stopping at the first match or indexing by the raw secret --
  neither which token matched nor whether any of them did is observable
  via timing.
- `policyHash`/`profileHash` (`policy-hashes.ts`) are computed directly
  from `policy.wasm`'s bytes and the execution profile's canonical JSON
  -- the same formulas `ddn-validator` itself uses -- without shelling
  out, since neither depends on request input.

## What this does not claim

- **Not distributed**: three isolated processes on one machine, not
  three independent operators on separate infrastructure. See
  `docs/decision-receipt-v1.md`'s own scope note.
- **Not a defense against a compromised deployment**: if the machine
  running `apps/api` and the validator instances is itself compromised,
  none of the above holds -- this model describes what a well-behaved
  deployment enforces against a network-level or application-level
  adversary, not host-level compromise.
- **Single verification profile per deployment**: there is no
  per-request choice among multiple execution profiles in this
  milestone (`docs/api-v1.md`'s "Verification profiles" section).
- **The timing-safety claim is scoped to token lookup specifically**,
  not a general claim about every code path in `apps/api` being
  constant-time.
