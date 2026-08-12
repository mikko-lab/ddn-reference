# Security policy

DDN Reference is a local reference implementation for verifiable
deterministic decisions. It is not a production validator network. Read
`docs/trust-model.md`, `docs/threat-model.md` and `docs/limitations.md` before
assessing or deploying it.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

The approved private reporting channel is **GitHub Private Vulnerability
Reporting** in this `mikko-lab/ddn-reference` repository. Open the
repository's **Security** tab, select **Advisories**, and choose **Report a
vulnerability**. Do not open a public GitHub Issue.

GitHub exposes Private Vulnerability Reporting only after the repository is
public. It must therefore be enabled and verified immediately after the
visibility transition, before the repository is announced or treated as a
public release. If it cannot be enabled, the repository must be returned to
private visibility until the maintainer approves another private channel.

A useful report should include the affected component and version or source
SHA, reproduction steps or a minimal test case, the expected security
property, observed impact and any suggested mitigation. Do not include real
customer data, production credentials or unnecessary sensitive material.

The maintainer will confirm receipt within a reasonable time, validate and
triage the report, coordinate a fix and tests, and agree on disclosure before
public details are posted. No fixed acknowledgement or remediation SLA is
promised by this reference project.

## In scope

- canonicalization or determinism divergence for the same pinned input,
  policy, profile and runtime;
- a WASM sandbox escape or bypass of fuel, memory, input, output or deadline
  limits;
- forged or double-counted validator attestations, request-binding bypasses,
  or a receipt being formed without the configured distinct-signer threshold;
- replay or policy/profile/version-confusion vulnerabilities;
- receipt, Merkle-proof or configured-anchor integrity bypasses;
- tenant isolation or authorization failures in the reference API;
- secret leakage through source, logs, process arguments or artifacts;
- dependency, build, CI or snapshot-integrity failures that can change the
  verified artifact without detection.

## Security boundaries and exclusions

The three validators are separate child processes on one host under one
operator. They are not independent infrastructure or a Byzantine-fault-
tolerant network. The verifier trusts a configured validator set and its EVM
RPC; it is not a light client. The demonstrated anchor is a local Anvil chain.
State and idempotency are in memory and do not survive restart. Signing keys
are local files; KMS/HSM custody, rotation and revocation are not implemented.

DDN verifies execution bindings and matching signed attestations. It does not
establish that a business rule, source input or outcome is correct, fair,
lawful or complete, and it does not process payments. A disagreement with the
synthetic negotiation policy is normally a policy-quality report rather than
a vulnerability in the verification protocol. Ordinary availability failures
are also out of scope unless they expose a security-boundary bypass.

This reference implementation is not an active production integration.
Missing or disabled integrations, including `NOT_CONFIGURED`, are an absence
of verification and must never be interpreted as a positive receipt.

## Keys, fixtures and supply chain

Never commit real signing keys, tokens, passwords or production configuration.
Runtime demo and E2E credentials are generated per run and removed at
teardown. Deterministic synthetic keys may exist only at exact manifest-listed
test-vector paths marked `TEST-ONLY / NEVER USE IN PRODUCTION`; a release scan
must reject them anywhere else.

Lockfiles, exact toolchain inputs, immutable GitHub Action SHAs, the public
snapshot allowlist, dependency-license review, SBOM generation, and redacted
Gitleaks and TruffleHog scans are release gates. The public snapshot must be a
new squashed import and must not include the private repository history.
