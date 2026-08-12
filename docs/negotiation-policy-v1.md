# negotiation-v1 policy

**This is a synthetic, technical demo policy — not a production pricing
policy.** It contains no real floor/target prices, reseller-specific data or
other content from a production sales system. Its test vectors
(`packages/test-vectors/vectors/negotiation-v1.json`) are entirely
synthetic/invented for this repository rather than derived from a production
system.

## Purpose

Prove the deterministic-decision-core claim end to end: the same
canonicalized input, run through the same versioned policy, produces the
same canonical output, `outputHash`, and (via the runner CLI)
`executionHash` — natively in Rust, inside a WASM sandbox, 1000 times in a
row, and across two independently-built `policy.wasm` binaries.

## Rules (evaluated in this order)

| Rule | Condition | Decision | `counterOfferCents` | Reason codes |
| --- | --- | --- | --- | --- |
| A | `conditionReportAcknowledged == false` | `ESCALATE` | `null` | `CONDITION_REPORT_NOT_ACKNOWLEDGED`, `HUMAN_REVIEW_REQUIRED` |
| B | `floorPriceCents > listPriceCents` | `ESCALATE` | `null` | `INVALID_PRICE_RELATION`, `HUMAN_REVIEW_REQUIRED` |
| C | `customerOfferCents >= listPriceCents` | `ACCEPT` | `null` | `OFFER_AT_OR_ABOVE_LIST` |
| D | `customerOfferCents >= floorPriceCents` | `ACCEPT` | `null` | `OFFER_AT_OR_ABOVE_FLOOR` |
| E | `customerOfferCents < floorPriceCents` and `offerNumber < maxOffers` | `COUNTER` | `floorPriceCents` | `OFFER_BELOW_FLOOR`, `FINAL_COUNTER_AVAILABLE` |
| F | `customerOfferCents < floorPriceCents` and `offerNumber >= maxOffers` | `REJECT` | `null` | `OFFER_BELOW_FLOOR`, `OFFER_LIMIT_REACHED` |

Rule B is defense-in-depth: `@ddn/schemas`' `validateNegotiationInputV1`
already rejects `floorPriceCents > listPriceCents` before a real caller
would ever reach the policy, but the policy still checks it and fails
closed (`ESCALATE`, not a panic or an arbitrary decision) in case invalid
data ever reaches it directly. The same applies to `offerNumber > maxOffers`.
Three vectors in `negotiation-v1.json` are marked `"defenseInDepth": true`
for exactly this reason — they deliberately violate a schema-level
invariant to exercise rule B and its `offerNumber`/`maxOffers` analogue,
and `@ddn/schemas` would reject their `input` before the policy ever sees
it in production.

`policyEffectiveAt` is carried through but **not evaluated** in this
version. The policy must not depend on a system clock, so this reference
implementation does not apply time-based policy activation.
`POLICY_NOT_EFFECTIVE` exists in the reason-code registry for a future
version that does.

## Purity constraints

`evaluate()` uses no system clock, no randomness, no network, no
filesystem, no environment variables, no floating-point arithmetic
(all prices are `i64` cents), no global mutable state, and no
locale-dependent logic. Reason codes are always pushed in a fixed,
explicitly-ordered `Vec`, never collected via `HashSet` iteration order.

## Property-based tests

`policies/negotiation-v1/src/lib.rs`'s `property_tests` module (via
`proptest`) checks, over randomly generated inputs:

- `COUNTER`'s price is never below `floorPriceCents` or above `listPriceCents`.
- `ACCEPT`/`REJECT` never carry a `counterOfferCents`.
- `ESCALATE` always sets `humanReviewRequired`.
- The same input always produces the same output (byte-for-byte, via `PartialEq`).
- Reason codes never repeat and their order is stable across repeated runs.
- No valid-shaped input causes a panic.

## Test vectors

24 synthetic vectors in `packages/test-vectors/vectors/negotiation-v1.json`
cover all four decisions, both boundary rounds (`offerNumber == 1` and
`offerNumber == maxOffers`), exact-floor/exact-list boundaries, the three
defense-in-depth cases above, and two large-safe-integer boundary cases.
Each vector carries `input`, `expectedOutput`, `canonicalInput`,
`inputHash`, `canonicalOutput`, and `outputHash` (all computed via the real
`ddn-canonical-json`/`ddn-crypto` crates, not hand-typed) — see
`policies/negotiation-v1/tests/vectors.rs`, which re-runs every vector
through native `evaluate()` and recomputes each of those fields to confirm
they still match.

`executionHash` is **not** pinned in this shared vector file: it depends on
`policyHash` (the hash of a specific `policy.wasm` build) and `profileHash`
(the hash of the execution profile config), both of which are build/runtime
artifacts, not properties of the decision logic itself. Baking a
wasm-build-dependent hash into vectors meant to validate *decision* logic
would make them fragile to any toolchain change unrelated to the policy.
`apps/validator` computes `executionHash` live for whichever policy package
it's pointed at — that's its actual purpose (see
`docs/execution-profile-v1.md`).

Four of the vectors are exposed as standalone fixture files under
`packages/test-vectors/fixtures/` (one per decision) for convenient manual
CLI runs, e.g.:

```bash
cargo run -p ddn-validator -- run \
  --policy policies/negotiation-v1/package \
  --input packages/test-vectors/fixtures/negotiation-counter.json
```
