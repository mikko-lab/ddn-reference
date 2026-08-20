**English** | [Suomi](README.fi.md)

# DDN — Deterministic Decision Network reference implementation

Open-source reference architecture for cryptographically verifiable decisions
executed by deterministic, versioned business rules.

DDN is a reference implementation, not a production validator network, and
not evidence that the underlying business rule is correct, fair, lawful, or
suitable for a particular use. It shows, concretely, what deterministic
policy execution combined with threshold-signed attestation and auditable
decision receipts can look like end to end — from a policy-as-code
definition through independent receipt verification, without asking anyone
to trust the coordinator's own claim that a decision was finalized.

## What DDN is

The reference stack starts one Rust validator binary as three isolated child
processes on the same host. A decision is accepted only when at least two
members of the configured three-member trusted validator set produce
matching Ed25519-signed attestations over the same execution result. This is
a fixed 2-of-3 trust model, not a permissionless network or a
Byzantine-fault-tolerant consensus protocol between independent operators.

An accepted decision produces a content-addressed `DecisionReceiptV1`. The
receipt contains each agreeing validator's Ed25519-signed attestation; the
coordinator does not add a separate signature over the receipt as a whole.
The standard verifier checks the attestations, threshold, request bindings,
hashes, Merkle proof and configured EVM anchor. Re-executing policy
semantics requires the separate `replay-verify` path and the exact policy
package.

The repository includes canonical JSON and crypto implementations, a
deterministic negotiation policy compiled to WebAssembly, a TypeScript API
and SDKs, a receipt verifier, Merkle batching, a Solidity anchor contract
and a browser demo. The blocking full-chain E2E uses real validator
subprocesses, API, browser applications, local Anvil chain and contract
without mocks. That statement does not apply to every unit test.

## Who it is for

This reference is for engineers and architects evaluating architectural
patterns for automated decision systems that need a verifiable trail —
teams researching deterministic policy execution, threshold-signed
attestation, or auditable decision receipts as a design pattern, and
security or protocol reviewers who want a concrete, runnable artifact to
study rather than a whitepaper. It is not a drop-in production service and
is not offered as one.

## What a decision receipt proves

A third party who receives a `DecisionReceiptV1` and runs the published
verifier — without trusting the coordinator's "finalized" claim — can
independently check that:

- the input was canonicalized and bound to specific policy, manifest and
  execution-profile hashes;
- at least two of the three configured trusted validators independently
  executed the same WASM policy package and produced matching
  Ed25519-signed attestations over the result;
- the receipt's shape, hashes, request bindings, validator identities and
  signatures, and the configured quorum threshold are all valid;
- a Merkle proof ties the receipt into a batch root, and that root matches
  what the configured EVM anchor contract returns via the configured RPC
  endpoint — demonstrated so far on a local Anvil chain.

## What DDN does not prove

- That the business rule encoded in the policy is correct, fair, lawful or
  suitable for a given use. DDN verifies that policy execution happened
  deterministically and was attested to — not that the policy itself is a
  good rule.
- That the ordinary verifier checked policy semantics. It does not execute
  the policy; only the separate `replay-verify` path, given the exact
  policy package, does that.
- That the three validators are independent infrastructure. In the
  reference deployment they are child processes of one binary on one host
  under one operator, not a network of independent operators.
- That the anchor is publicly observable. The EVM anchoring shown here runs
  on a local Anvil chain, not a public testnet or mainnet.
- That decision state persists. The coordinator and anchor repositories are
  in memory and do not survive a restart.
- That DDN provides KMS/HSM-backed key custody, rotation or revocation.
  Signing keys are local files in this reference.
- That DDN evaluates or verifies an AI model's free-form reasoning. In a
  system that also relies on an LLM or other AI model, DDN's deterministic
  policy layer can act as an audit boundary for the parts of a decision
  that are encoded as policy-as-code — but it does not verify, constrain or
  audit the model's own reasoning.
- That DDN processes payments. It does not.

## Reference architecture

- `apps/` — TypeScript services (`api`, `coordinator`, `anchor-service`,
  `explorer`, `demo-reference`) and the Rust validator service
  (`apps/validator`).
- `packages/` — shared libraries. `canonical-json` and `crypto` ship both a
  TypeScript and a Rust implementation, cross-verified against each other
  via shared test vectors.
- `policies/` — versioned decision policies, written in Rust, compiled to
  WebAssembly.
- `contracts/` — a Foundry (Solidity) project with the decision-anchor
  contract.
- `infra/` — Dockerfiles for reproducible and isolated build profiles.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full repository layout and
the architectural decision records under `docs/decisions/`.

## Current evidence and limitations

Current evidence is intentionally narrow:

- the three validators run on one host and use the same binary;
- EVM anchoring has been exercised on a local Anvil chain only;
- the verifier trusts its configured RPC endpoint and is not a light
  client;
- repository and idempotency state are in memory and do not survive
  restart;
- no KMS/HSM, key rotation or independent validator operators are
  included;
- policy reproducibility is established for the pinned Linux/arm64
  profile; Linux/amd64 remains experimental and is not a release claim;
- DDN neither processes payments nor replaces the business rule it
  verifies;
- this reference implementation is not an active production integration.

Read [the trust model](./docs/trust-model.md),
[known limitations](./docs/limitations.md), and
[threat model](./docs/threat-model.md) before evaluating or running the
code. The verified public-project wording is available in
[English and Finnish](./docs/public-project-description.md).

## Getting started

See [CONTRIBUTING.md](./CONTRIBUTING.md) for prerequisites, the full
repository layout, and common commands (`pnpm install`, build/lint/test,
policy build and verification, and the real end-to-end suite).

## Security

See [SECURITY.md](./SECURITY.md). Do not open a public issue for a
suspected vulnerability — use GitHub Private Vulnerability Reporting on
this repository instead.
