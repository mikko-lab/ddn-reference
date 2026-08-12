# ADR-001: No custom blockchain

## Status

Accepted

## Context

DDN needs a way to make its decision receipts publicly, cryptographically
verifiable without trusting the originating application. Building a
purpose-built blockchain (own consensus, own validator set, own token) is
one way to get that, but it is also the most expensive, slowest, and
highest-risk path — and DDN's actual claim is narrower than what a general-
purpose chain is built to prove: that a
fixed input was executed against a versioned rule by the required number of
independent operators, and they agreed.

## Decision

DDN does not build, and will not build, its own blockchain. Where an
immutable public anchor is needed, DDN anchors batched
Merkle roots to an existing EVM testnet via a minimal contract
(`DecisionAnchor.sol`). The chain's only job is to make a root
tamper-evident and timestamped; it never executes DDN's business logic and
never stores raw decision data (see ADR-005).

## Consequences

- No consensus protocol, block production, or validator-incentive design
  work is owned by this project.
- DDN's security model rests on independent re-execution + signature
  quorum, not on chain-level Byzantine fault tolerance.
- Anchoring is decoupled from decision finality: a decision is finalized
  when quorum is reached (`FINALIZED`), independent of whether/when
  it is later anchored (`ANCHORED`).
