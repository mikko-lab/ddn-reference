# Known limitations

This repository is a reference implementation, not a production service.

- Three validator instances are same-host child processes of one binary. A
  host, operator, binary or dependency compromise can affect all three.
- The trusted set is fixed and configured. There is no permissionless
  admission, stake, slashing, peer-to-peer protocol or BFT network.
- The coordinator and anchor repositories are in memory. Decisions,
  idempotency records, pending batches and confirmation state are lost on
  restart; multi-instance operation is unsupported.
- The browser verifier trusts one configured EVM RPC endpoint. It does not
  verify chain consensus as a light client.
- Anchoring is verified only on a local Anvil chain. No public testnet or
  mainnet deployment is represented.
- Reproducible policy builds are established only for the pinned Linux/arm64
  profile. Linux/amd64 is experimental and non-blocking.
- The public reference BFFs use scoped service tokens and are not a general
  user-authentication or authorization solution.
- Signing keys are local files. There is no KMS/HSM integration, rotation,
  revocation workflow, independent custody or operator governance.
- The ordinary verifier proves receipt integrity and configured quorum; it
  does not prove policy semantics. Semantic replay requires the exact pinned
  policy artifact and `replay-verify`.
- DDN verifies deterministic execution. It cannot establish that a business
  rule, its input, or its outcome is correct, fair, lawful or complete.
- DDN does not process payments.
- The repository contains no active production integration, and this reference
  implementation is not enabled in any public production traffic.
