# Threat model

## Assets and claims

Protected assets are validator signing keys, service credentials, tenant data,
policy and profile bindings, receipt integrity, validator-set membership,
Merkle roots and anchor configuration. The defended claim is narrow: a fixed
input and pinned deterministic rule produced matching results attested by the
configured threshold.

## Trust boundaries

1. Caller to API: authentication, tenant binding, replay and input validation.
2. Coordinator to three validator subprocesses: request/package pinning,
   bounded execution, result parsing and signature verification.
3. Validator to WASM policy: no WASI, bounded fuel, memory, input, output and
   deadline.
4. Receipt to verifier: canonical hashes, distinct trusted signers and quorum.
5. Merkle proof to EVM anchor: local proof plus a configured RPC and contract.
6. Build and release inputs: lockfiles, toolchains, policy artifacts, Actions
   and the future squashed public snapshot.

## In-scope threats

- malformed or non-canonical input, replay and version-confusion attacks;
- package, schema, profile, result, receipt or Merkle-proof tampering;
- signature forgery, signer double-counting and untrusted-key substitution;
- validator disagreement, trap, timeout or resource exhaustion being treated
  as success;
- WASM filesystem, network, clock or randomness access;
- tenant crossover and sensitive data reaching public receipts or chain data;
- credential leakage through source, logs, process arguments or artifacts;
- malicious dependencies, unpinned automation and non-reproducible builds;
- a dishonest or compromised RPC returning a false anchor view.

## Fail-closed expectations

Unknown fields, invalid canonicalization, binding mismatch, untrusted signer,
invalid signature, insufficient distinct matching attestations, resource trap,
timeout, missing integration or unconfigured anchor must not create a verified
receipt. `NOT_CONFIGURED` is an absence of evidence, never a synthetic receipt
or positive verification.

## Residual risks

Same-host validator compromise is not mitigated by process count. The API and
coordinator remain availability and data-plane trust points. The RPC is trusted
rather than cryptographically proven by a light client. Local file keys lack
hardware protection and lifecycle controls. In-memory state is vulnerable to
restart loss. The reference has not been independently audited or penetration
tested.

## Out of scope

Business-rule quality, legal compliance, fairness, source-data truth, payment
processing, public-chain economics and production service-level guarantees are
outside the verification claim.
