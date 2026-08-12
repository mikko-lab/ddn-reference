# Decision anchoring v1 (Milestone 6)

Anchoring makes a batch of already-`FINALIZED` receipts tamper-evident and
timestamped on a public chain. It proves nothing about business logic and
changes nothing about when a decision is trustworthy: a decision is
authoritative the moment quorum is reached (Milestone 4, `FINALIZED`),
independent of whether or when it is later anchored. See
[`docs/decisions/ADR-001-no-custom-blockchain.md`](decisions/ADR-001-no-custom-blockchain.md)
and
[`docs/decisions/ADR-005-public-chain-stores-roots-only.md`](decisions/ADR-005-public-chain-stores-roots-only.md).

## What the chain does and does not hold

`DecisionAnchor.sol` (`contracts/src/DecisionAnchor.sol`) accepts a batch's
`(batchId, merkleRoot, decisionCount)`, rejects reuse of a `batchId`
unconditionally (matching or conflicting content alike), records the
submitter, and emits `BatchAnchored`. It never sees a receipt's raw input,
output, or any tenant-identifying data — only a Merkle root over
`receiptId`s.

One deliberate security requirement in the `IDecisionAnchor` interface is an
**immutable `authorizedSubmitter`**
set at deploy time, checked on every `anchorBatch` call. The literal
interface had no access control at all, which left both an
unauthorized-submitter and a mempool front-running gap open; this closes
both without changing `anchorBatch`/`getBatch`/`BatchAnchored`'s signatures.

Zero-value inputs (`authorizedSubmitter`, `batchId`, `merkleRoot`,
`decisionCount`) are rejected explicitly — Solidity's zero value is also
the default for an unset mapping entry, so leaving these unchecked would
make a never-anchored batch and a legitimately-anchored all-zero one
indistinguishable.

## Merkle leaf, tree, and batch id

A leaf commits to a receipt's `receiptId` alone —
`hash("DDN_RECEIPT_LEAF_V1", { receiptId })` — nothing else. No `tenantId`,
no batch-position counter: `receiptId` already fully commits to the
receipt's request/quorum/consensus/signed results (`computeReceiptId`,
`decision-receipt.ts`), so adding anything else to the leaf would be
redundant and would let anyone scanning the public tree correlate leaves to
tenants without needing the receipt itself.

- Leaves are sorted lexicographically by `receiptId` before a tree is
  built, so the root never depends on collection order.
- A duplicate `receiptId` in one batch is rejected outright
  (`MerkleError('DUPLICATE_RECEIPT_ID', ...)`), never silently deduped.
- A lone node at any level (not just the leaf level) is paired with a
  duplicate of itself to advance — applied recursively, bottom-up.
- `batchId = hash("DDN_ANCHOR_BATCH_V1", { merkleRoot, decisionCount })` —
  no sequence counter. Two batches sharing both fields necessarily share
  the same receipt set (the root already strongly commits to content), so
  collapsing them under one `batchId` is correct, not a collision risk — it
  makes a retry after a crash naturally idempotent instead of needing
  durable, coordinated counter state.

See `packages/receipt-sdk/src/merkle.ts`.

## `AnchorRecordV1`

Returned by `GET /v1/decisions/{decisionId}/anchor` once (and only once)
anchoring reaches `CONFIRMED`. Keyed by `receiptId` — what the leaf
actually commits to — even though the URL is addressed by `decisionId`,
matching the rest of the API's convention. `DecisionReceiptV1` itself gains
no new field for this.

```
{
  schemaVersion, receiptId, batchId, merkleRoot,
  proof: { leafHash, leafIndex, siblings, totalLeaves },
  chain: { chainId, contractAddress },
  confirmation: { txHash, blockNumber, blockHash, confirmedAt },
}
```

Every response and request schema uses `additionalProperties: false` at
every nesting level (`packages/schemas/json/api-v1/get-anchor-response.schema.json`).

## Verification: two layers, not one

`@ddn/receipt-sdk` exposes two functions, deliberately not one
(`packages/receipt-sdk/src/anchor-verification.ts`):

- **`verifyReceiptAgainstSuppliedBatch`** — pure, low-level. Trusts whatever
  `onChainBatch` its caller supplies. Not itself a trust boundary; useful
  for unit tests without a live chain connection.
- **`verifyAnchoredDecisionReceipt`** — the actual trust boundary. Takes a
  `ChainReader` bound at construction to one configured
  `chainId`/`contractAddress` and fetches `getBatch` itself — there is no
  parameter for a caller to substitute a stale or fabricated batch through.

Both run the same ordered gates, none short-circuited into "looks fine
overall":

1. `verifyDecisionReceipt` first (Milestone 4) — an anchor can never rescue
   a receipt that fails its own signature/quorum check.
2. Recompute `receiptId` and the leaf hash from the receipt itself; compare
   against the anchor record's own values.
3. Structural proof checks: `leafIndex < totalLeaves`, exact proof length
   (`ceil(log2(totalLeaves))`), and `proof.totalLeaves === onChainBatch.decisionCount`.
4. Replay the proof to confirm it reconstructs `anchorRecord.merkleRoot`.
5. Confirm that root matches the independently-supplied/fetched on-chain
   batch.
6. Confirm `anchorRecord.chain` matches the caller-configured trusted
   chain.

A result's `failedAt` (`RECEIPT | LEAF_MISMATCH | PROOF | ON_CHAIN_MISMATCH
| CHAIN_BINDING`) tells a caller which layer failed — "the receipt is bad"
and "the receipt is fine but the anchor is wrong" are different failure
classes worth distinguishing.

## The anchor sidecar: in-process, not a separate service

`@ddn/anchor-service` is an **in-process library**, not a separate
deployable process — `apps/api`'s `server.ts` constructs and injects it the
same way it already constructs and injects `@ddn/coordinator`'s `decide()`.
There is no HTTP interface and no service token for it: the worker reads
`FinalizedDecisionRecord.receipt` directly off the same in-memory
`DecisionRepository` instance it shares a process with.

This is a deliberate, explicitly-scoped simplification for Milestone 6, not
an oversight:

- **No API-restart durability.** An `apps/api` restart loses all anchor
  sidecar state exactly as it already loses all decision state
  (`InMemoryDecisionRepository`, Milestone 5) — this introduces no new
  loss.
- **No multi-instance operation.** Only one `apps/api` process may run at a
  time; there is structurally one writer, so no locking/coordination design
  is needed.
- Durable, multi-instance operation would require a shared receipt store,
  transactional outbox and separately authenticated worker. Those capabilities
  are explicitly out of scope for this reference implementation.

### Finalization boundary

`apps/api/src/decisions/finalize.ts` ties the `RUNNING -> FINALIZED`
transition to anchor-eligibility marking as one synchronous local
boundary — deliberately not `await transition(); enqueue();`. Anchor
eligibility is marked **first**, synchronously; only if that succeeds does
the transition run. If the sidecar throws, the transition never happens at
all, so a decision can never reach `FINALIZED` without also being marked
`ELIGIBLE`. This is in-process atomicity only (both stores are
synchronous, in-memory, same process) — never a durable transaction.

### Sidecar state machine

Entirely separate from `DecisionStatus`
(`PENDING`/`RUNNING`/`FINALIZED`/`NO_QUORUM`/`FAILED`, unchanged):

```
ELIGIBLE -> BATCHED -> SUBMITTED -> CONFIRMED
                            |            |
                      (revert/drop) (blockHash mismatch at blockNumber)
                            v            v
                        ELIGIBLE <- REORG_PENDING -> CONFIRMED
                                    (re-fetch getBatch: genuinely dropped
                                     -> rebatch fresh; actually landed
                                     -> refreshed block evidence)
```

After a bounded number of retries, a batch's entries move to the terminal
`ANCHOR_FAILED` instead of retrying forever — logged server-side
(`console.error`), never surfaced raw to a client. `GET
/v1/decisions/{decisionId}/anchor` responds `409 ANCHOR_NOT_AVAILABLE` for
every state short of `CONFIRMED`, including "not yet `FINALIZED` at all" —
never the sidecar's internal status, a raw RPC error, or a secret.

See `apps/anchor-service/src/sidecar-store.ts` and `worker.ts`.

## Chain client

`@ddn/anchor-service`'s `AnchorChainClient` (viem-based) is broader than
`@ddn/receipt-sdk`'s lightweight `ChainReader` — it also submits batches and
reads transaction receipts/blocks for confirmation and reorg tracking, none
of which a verifier needs. It implements `ChainReader` structurally, so the
same object satisfies both roles.

`submitAnchorBatch` treats a `BatchAlreadyAnchored` revert as a successful
idempotent retry **only if** `getBatch`'s on-chain content matches exactly
what was intended, recovering the original transaction via the indexed
`BatchAnchored` event. Any other content is fail-closed and thrown — a
`batchId` reused with different content is never silently absorbed as a
retry.

`bytes32.ts` is the only place a `Sha256Digest` crosses into/out of
Solidity's `bytes32` representation; everywhere else stays in
`sha256:...` string form.

## Local Anvil only

This implementation runs and is tested against a local Anvil node only. It
does not include or promise a public testnet or mainnet deployment (ADR-001).
`apps/anchor-service/src/chain-client.integration.test.ts` proves the chain
client against a real, ephemeral local Anvil instance (spawned and torn
down by the test itself), not a mock.

## Known limitations

- No cross-process durability or multi-instance operation (see above).
- Mixed-tenant batching remains in scope for the Merkle tree (one tree can
  span tenants); the read side (`GET .../anchor`) stays tenant-isolated
  exactly like `GET .../receipt`. A genuinely separate `@ddn/anchor-service`
  process needing to fetch other tenants' receipts over HTTP would need a
  new, deliberately cross-tenant service-role concept — today's
  `ServiceTokenPrincipal.tenantId` is always singular, and that is not
  retrofitted here.
- Gas costs are recorded (`forge test --gas-report`, wired into CI) but not
  optimized.
