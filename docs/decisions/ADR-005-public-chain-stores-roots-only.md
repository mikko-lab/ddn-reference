# ADR-005: Public chain stores roots only

## Status

Accepted

## Context

Anchoring decision receipts on a public chain (ADR-001)
creates a permanent, world-readable record. DDN's customers' decisions can
involve confidential data and, in some deployments, data connected to
identifiable individuals. The security
boundary is explicit about what must never reach a public chain:
personal data, customer-identifying data, raw decision inputs and outputs,
or other confidential application data.

## Decision

The only data that ever reaches the public chain is: a batch ID, a Merkle
root, a decision count, and the resulting contract event
(`DecisionAnchor.sol`). Receipt contents and validator signatures remain
off-chain behind the application's authorization boundary. A receipt's
Merkle proof lets a holder verify that a specific receipt was included in
an anchored batch without publishing that receipt's content to the chain.

## Consequences

- The Merkle batching design is not optional scaffolding —
  it is the mechanism that keeps private data private while still letting
  anyone verify inclusion against a public root.
- Application authorization and data isolation are prerequisites for safe
  anchoring, not independent nice-to-haves.
- Hashing a small or guessable value does not make it safe to publish. Such
  values must not be used as public references under this ADR.
