# ADR-003: Canonical JSON

## Status

Accepted

## Context

Hashing is only meaningful if two semantically identical values always
produce the same byte string to hash. Plain `JSON.stringify`/`serde_json`
output is not safe for this: object key order, whitespace, number
formatting, and duplicate-key handling can all vary between languages,
libraries, and even between two calls in the same language, which would
make `inputHash`/`outputHash`/`policyHash` comparisons meaningless across
TypeScript and Rust validators.

## Decision

All hashed data goes through the transform specified in
`../canonical-json-profile-v1.md`: object keys sorted into canonical order, no
insignificant whitespace, no `undefined` values, no duplicate keys, no
`NaN`/`Infinity`, integer-only numbers for this use case, a documented
UTF-8 normalization policy, and UTC ISO 8601 dates. The target is RFC 8785
(JSON Canonicalization Scheme) compatibility, implemented in
`packages/canonical-json` — in both TypeScript and Rust, verified against
each other via shared test vectors (Milestone 1).

## Consequences

- `packages/canonical-json` is on the critical path for every hash in the
  system (`inputHash`, `outputHash`, `policyHash`, `profileHash`,
  `executionHash`) — it needs official test vectors and cannot silently
  drift between its TypeScript and Rust implementations.
- Policies are restricted to canonicalizable data shapes (ADR-002's integer-
  only numeric constraint exists partly to keep canonicalization
  unambiguous — no float rounding-mode disagreements between languages).
- A canonicalization bug is a security bug: it can make two operators'
  correct, matching decisions hash differently, producing a false
  disagreement (or worse, make two different decisions hash the same).
