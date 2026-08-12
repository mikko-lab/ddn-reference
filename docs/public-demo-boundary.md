# Public demo and explorer boundary

The public demo surfaces make the reference implementation observable without
changing the protocol rules that determine whether a decision is trustworthy.
They are local reference components, not a production deployment target or an
authentication product.

## Included public surfaces

- `apps/explorer` provides the public receipt, validator-progress and anchor
  verification views.
- `apps/demo-negotiation-reference` provides a synthetic offer flow against
  `policies/negotiation-v1` and displays the resulting decision state.
- `@ddn/demo-web-kit` contains shared polling, DTO mapping and presentation
  helpers for those surfaces.
- `@ddn/receipt-ui` contains presentation-only receipt and verification
  components.
- `@ddn/demo-trust-profile` contains the pinned validator-set and local-chain
  trust material used by the deterministic demo.

The snapshot contains only the two public reference surfaces listed above.
Authentication and application surfaces outside that boundary are neither
named nor copied. Public components must not import or depend on excluded
implementations.

## Fail-closed configuration

Browser code never receives a service token. Each public BFF reads its scoped
token only on the server. Missing or partial server configuration results in a
not-configured response; there is no default token, default backend or
unauthenticated upstream fallback.

The reference demo uses synthetic inputs and fixed test-only trust fixtures.
Those fixtures are not production credentials and are marked accordingly in
their source files. Real application data and deployment credentials are out
of scope for this repository.

## Local verification

The end-to-end suite runs the validator, pinned WASM policy, API, local Anvil
chain and both public browser surfaces without replacing those components with
mocks:

```bash
pnpm --filter @ddn/e2e run test:e2e
```

Prerequisites are checked before the suite starts. A missing prerequisite is a
failure, not a skip or mock substitution. Processes and temporary validator
files created by the suite are cleaned up after success or failure.

## Limitations

- The public BFFs are demo-only and are not a general authentication or
  authorization solution.
- The local chain, in-memory state and demo credentials are not suitable for
  public-internet or production use.
- One deterministic end-to-end path does not prove protocol completeness,
  security or accessibility conformance.
- Production deployments require their own identity, authorization, secret
  management, durable storage, monitoring and operational review.

See `docs/limitations.md`, `docs/api-security-model.md`,
`docs/threat-model.md` and `docs/trust-model.md` for the broader public safety
boundary.
