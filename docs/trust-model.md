# Trust model

## Reference deployment

The reference coordinator starts one `ddn-validator` Rust binary three times
as separate operating-system child processes on the same host. The processes
have separate address spaces and signing-key files, but they share the host,
binary, policy package, execution profile and operator. Process isolation
limits accidental cross-instance state; it is not independence from a host,
operator, compiler or supply-chain compromise.

The coordinator uses a versioned, explicitly configured validator set. The
demo set contains three public keys and a threshold of two. Only distinct
trusted validator identities with valid Ed25519 attestations over matching
execution bindings count toward the threshold. This is neither permissionless
membership nor a BFT protocol.

## Decision and receipt

The policy input is canonicalized and bound to its policy, manifest and
execution-profile hashes. Each validator executes the same WASM package with
WASI disabled, fuel, linear-memory, input, output and in-process deadline
limits. It signs its own result attestation. A timeout, trap, malformed result,
bad signature or disagreement does not count toward quorum.

`DecisionReceiptV1` is content-addressed and contains the agreeing validators'
signed attestations. There is no coordinator key that signs the receipt as a
whole. The coordinator is still trusted for availability, correct request
routing and faithful assembly of already-verifiable material; it cannot create
a valid validator signature.

## Verification levels

The ordinary verifier checks receipt shape, hashes, request bindings,
validator identities and signatures, the configured threshold, Merkle proof,
and the root returned by the configured EVM RPC endpoint. It does not execute
the policy and it is not an EVM light client.

`ddn-validator replay-verify` is the stronger semantic path. It needs the exact
request, policy package and execution profile, recomputes their bindings,
executes the WASM again and compares the result. Its conclusion is only as
strong as the supplied artifact and local runtime.

## Anchor trust

The demonstrated chain is a fresh local Anvil process. The verifier trusts the
selected RPC response and the configured contract address. No public testnet,
mainnet, finality service, RPC diversity or light-client proof is claimed.

## Keys and operators

Runtime demo and E2E identities are generated per run and removed at teardown.
Committed deterministic keys exist only in explicitly marked test-vector
fixtures. The reference does not provide KMS/HSM custody, key rotation,
revocation, independent operators, remote attestation or threshold key
generation.
