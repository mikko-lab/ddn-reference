# DDN API v1 (Milestone 5)

Milestone 4 proved that three isolated validator instances converge on a
`DecisionReceiptV1` anyone can verify offline. Milestone 5 proves the next
thing: that a client with **no access to `@ddn/coordinator`, the
`ddn-validator` binary, or any private key** — only an HTTP connection and
the workspace `@ddn/client-sdk` reference package — can submit a decision, poll it,
fetch its receipt, and verify that receipt itself, without ever trusting
the server's own "FINALIZED" claim.

`apps/api` is the HTTP surface. It does not re-implement anything
Milestones 1-4 already built: it authenticates a caller, validates and
reconciles a request, calls `@ddn/coordinator`'s `decide()` exactly as
`apps/coordinator`'s own CLI does, and self-verifies the resulting receipt
with `@ddn/receipt-sdk` before ever reporting `FINALIZED`.

## Responsibility split, by design

- **`ddn-validator` (Rust)** — unchanged. Still the only component that
  executes policy and signs a result.
- **`@ddn/coordinator` (TypeScript)** — unchanged. Still spawns N isolated
  validator instances and hands their output to `@ddn/receipt-sdk`.
- **`apps/api` (TypeScript, new)** — HTTP boundary only: auth, tenant
  isolation, request validation, the decision state machine, idempotency,
  and orchestrating the two steps above per request. It never executes
  `policy.wasm` and never holds more than the file *paths* to validator
  private keys (each instance's own child process reads its own key file;
  `apps/api` never loads private key bytes into its own memory).
- **`@ddn/client-sdk` (TypeScript, new)** — a dependency-light reference
  client. Depends only on `@ddn/schemas` (the wire contract) and
  `@ddn/receipt-sdk` (offline verification) — never on `@ddn/coordinator`.
  This is not a convenience restriction; it is the thing this milestone
  needed to prove is even possible.

## Auth: service tokens, not user accounts

Every route except `GET /healthz` requires `Authorization: Bearer
<token>`. A token maps to a `ServiceTokenPrincipal` (`tokenId`, `tenantId`,
`roles`) via `DDN_SERVICE_TOKENS` (a JSON array of `{token, tokenId,
tenantId, roles}`, configured at boot — see `apps/api/src/config.ts`).
Lookup compares SHA-256 fingerprints of the presented and configured
tokens with `crypto.timingSafeEqual`, scanning every configured token
rather than indexing by the raw secret, so neither which token matched nor
whether any of them did is observable via timing (`apps/api/src/auth/token-registry.ts`).

Four roles gate the four route groups: `decision:submit`, `decision:read`,
`receipt:verify`, `policy:read`.

## Tenant isolation

A service token belongs to exactly one tenant. `POST /v1/decisions`
reconciles `input.tenantId` against the authenticated principal
(`apps/api/src/auth/tenant-context.ts`) **before** the stricter
`negotiation-input-v1.schema.json` check runs (which requires `tenantId`
to be present):

- absent → injected from the principal
- present and matching → accepted unchanged
- present and conflicting → `403 TENANT_MISMATCH`

`GET /v1/decisions/{decisionId}` and its `/receipt` sibling report
`404 DECISION_NOT_FOUND` — not `403` — for a decision that belongs to a
different tenant. A client must never be able to distinguish "this
decisionId belongs to someone else" from "this decisionId never existed."

## The decision state machine

```
PENDING -> RUNNING -> FINALIZED
                    -> NO_QUORUM
                    -> FAILED
```

`FINALIZED`/`NO_QUORUM`/`FAILED` are terminal — there is no transition out
of them. `apps/api/src/decisions/types.ts`'s `ALLOWED_DECISION_TRANSITIONS`
is the single source of truth for this; `InMemoryDecisionRepository.transition()`
enforces it via compare-and-set (expected current status + the transition
table), throwing `DECISION_STATE_CONFLICT` otherwise.

`POST /v1/decisions` only ever creates a `PENDING` record and returns
immediately; the actual quorum run happens in the background
(`apps/api/src/decisions/process-decision.ts`). A client is expected to
poll `GET /v1/decisions/{decisionId}` (or use `@ddn/client-sdk`'s
`submitWaitAndVerify`, which does this for you) until it sees a terminal
status.

## Idempotency

Two submissions with the same tenant, policy, input, and verification
profile are the same logical request:

```
idempotencyRequestHash = SHA256(canonical {
  domain: "DDN_API_DECISION_REQUEST_V1",
  value: { tenantId, policy, input, verificationProfileId }
})
```

`DecisionRepository.createOrGetByIdempotencyKey()` is a synchronous
check-then-set (no `await` between the read and the write — see
`apps/api/src/decisions/decision-repository.ts`), so two callers racing
for the same idempotency key can never both create a decision. A replay
of an already-submitted request returns the **existing** decision in
whatever state it has actually reached (HTTP 200), not a re-asserted
`PENDING` claim (HTTP 201 is reserved for a genuinely new decision).

## Verification profiles

`DDN_EXECUTION_PROFILE_PATH` points at exactly one execution profile for
this deployment (e.g. `packages/config/profiles/ddn-wasm-v1.json`), which
already carries its own `profileId` field for its own purposes. A
request's `verificationProfileId` must match that value exactly, or the
request is rejected with `400 UNKNOWN_VERIFICATION_PROFILE`
(`apps/api/src/policies/verification-profile.ts`). There is no per-request
choice among multiple profiles in this milestone.

## The receipt self-verification gate

Before a decision is ever allowed to transition to `FINALIZED`,
`apps/api/src/decisions/decision-runner.ts` independently re-verifies the
receipt `@ddn/coordinator` just assembled, using `@ddn/receipt-sdk`'s
`verifyDecisionReceipt` against the deployment's own trusted
`ValidatorSetV1` file. If that check does not pass, the decision resolves
to `FAILED` with code `RECEIPT_SELF_VERIFICATION_FAILED` — never
`FINALIZED` on a receipt this process could not itself verify, even though
it was the one that assembled it.

## Policy hashes without shelling out

`GET /v1/policies` and its detail endpoint report `policyHash` and
`profileHash` computed the same way `ddn-validator` computes them
(`apps/validator/src/lib.rs`'s `load_policy`/`load_profile`) — reimplemented
in TypeScript (`apps/api/src/policies/policy-hashes.ts`) rather than
invoked via a subprocess, because neither hash depends on any request
input:

- `policyHash = SHA256(policy.wasm bytes)`
- `profileHash = hash_canonical_json("DDN_PROFILE_V1", <profile.json content>)`

## Endpoints

| Method & path | Role required | Notes |
| --- | --- | --- |
| `POST /v1/decisions` | `decision:submit` | Returns `DecisionStatusResponseV1` — 201 (fresh, `PENDING`) or 200 (idempotent replay, whatever state it reached) |
| `GET /v1/decisions/{decisionId}` | `decision:read` | Same response shape as the POST |
| `GET /v1/decisions/{decisionId}/receipt` | `decision:read` | The raw `DecisionReceiptV1` — only once `FINALIZED` (`409 RECEIPT_NOT_AVAILABLE` otherwise) |
| `GET /v1/decisions/{decisionId}/anchor` | `decision:read` | `AnchorRecordV1` proving the receipt was anchored on-chain — only once `CONFIRMED` (`409 ANCHOR_NOT_AVAILABLE` otherwise). See `docs/anchor-v1.md` (Milestone 6) |
| `POST /v1/receipts/verify` | `receipt:verify` | Convenience server-side re-check; never a substitute for local verification |
| `GET /v1/policies` | `policy:read` | Every registered policy, its hashes, and `ACTIVE`/`INACTIVE` status |
| `GET /v1/policies/{policyId}/{policyVersion}` | `policy:read` | Adds `inputSchema`/`outputSchema`/`reasonCodes` |
| `GET /healthz` | none | Liveness only |

The full machine-readable contract is generated deterministically from the
same JSON Schema files (`packages/schemas/json/api-v1/`) that validate
these requests/responses at runtime — see `apps/api/openapi/ddn-api-v1.json`
and `apps/api/src/openapi/`. `pnpm --filter @ddn/api run openapi:check`
(wired into CI) fails if that file is out of date; only
`pnpm --filter @ddn/api run openapi:generate` may update it, and only a
human commits the result.

## The external-client trust model

This is the reason `@ddn/client-sdk` exists as its own package rather than
a thin wrapper the API team also controls end to end:

```ts
import { DdnClient, submitWaitAndVerify } from '@ddn/client-sdk';

const client = new DdnClient({ baseUrl, serviceToken });
const validatorSet = /* obtained out-of-band, independently trusted --
                         never fetched from the server being verified */;

const { result, receipt, verification } = await submitWaitAndVerify(
  client,
  submitDecisionRequest,
  { validatorSet },
);
// verification.ok === true here is not the server's word for it --
// it is this process's own call to @ddn/receipt-sdk's
// verifyDecisionReceipt, run locally, against a validator set this
// caller already trusted before making the request.
```

`submitWaitAndVerify` submits, polls `GET /v1/decisions/{decisionId}`
until a terminal status, fetches the raw receipt, and only then verifies
it. A tampered or invalid receipt throws `DdnReceiptVerificationError`
**even when the server's own status field says `FINALIZED`** — see
`packages/client-sdk/src/submit-wait-and-verify.test.ts`'s tampered-receipt
test, and `apps/api/src/external-client-e2e.test.ts` for the same proof
over a real TCP connection (3/3 quorum, a degraded 2/3, and `NO_QUORUM`,
all driving three real `ddn-validator` subprocesses).

## Error codes

Every non-2xx response is `ApiErrorResponseV1`: `{schemaVersion, error:
{code, message, requestId, details?}}`. See `apps/api/src/errors/api-error.ts`
for the full `ApiErrorCode` union and its HTTP status mapping. Never
included in `message`/`details`: stack traces, file paths, validator
stderr, private key paths, or bearer tokens.

For the full security model this API implements -- trust boundaries,
tenant isolation, the fail-closed principles behind the receipt
self-verification gate, exactly what a client response may contain
versus what only a server log may, and the key/validator-process
boundaries -- see `docs/api-security-model.md`.
