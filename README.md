# DDN — Deterministic Decision Network reference implementation

DDN is a reference implementation for checking significant decisions made
by deterministic, versioned business rules. It is not a production validator
network and it is not evidence that the underlying business rule is correct,
fair, lawful, or suitable for a particular use.

The reference stack starts one Rust validator binary as three isolated child
processes on the same host. A decision is accepted only when at least two
members of the configured three-member trusted validator set attest to the
same execution result. This is a fixed 2-of-3 trust model, not a permissionless
network or a Byzantine-fault-tolerant consensus protocol between independent
operators.

An accepted decision produces a content-addressed `DecisionReceiptV1`. The
receipt contains each agreeing validator's Ed25519-signed attestation; the
coordinator does not add a separate signature over the receipt as a whole.
The standard verifier checks the attestations, threshold, request bindings,
hashes, Merkle proof and configured EVM anchor. Re-executing policy semantics
requires the separate `replay-verify` path and the exact policy package.

The repository includes canonical JSON and crypto implementations, a
deterministic negotiation policy compiled to WebAssembly, a TypeScript API and
SDKs, a receipt verifier, Merkle batching, a Solidity anchor contract and a
browser demo. The blocking full-chain E2E uses real validator subprocesses,
API, browser applications, local Anvil chain and contract without mocks. That
statement does not apply to every unit test.

Current evidence is intentionally narrow:

- the three validators run on one host and use the same binary;
- EVM anchoring has been exercised on a local Anvil chain only;
- the verifier trusts its configured RPC endpoint and is not a light client;
- repository and idempotency state are in memory and do not survive restart;
- no KMS/HSM, key rotation or independent validator operators are included;
- policy reproducibility is established for the pinned Linux/arm64 profile;
  Linux/amd64 remains experimental and is not a release claim;
- DDN neither processes payments nor replaces the business rule it verifies;
- this reference implementation is not an active production integration.

Read [the trust model](./docs/trust-model.md),
[known limitations](./docs/limitations.md), and
[threat model](./docs/threat-model.md) before evaluating or running the code.
The verified public-project wording is available in
[English and Finnish](./docs/public-project-description.md).

## Getting started

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and common commands.

## Security

See [SECURITY.md](./SECURITY.md).
