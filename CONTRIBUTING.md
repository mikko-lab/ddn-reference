# Contributing to DDN

## Prerequisites

- Node.js ≥ 22, [pnpm](https://pnpm.io) 10.x (`corepack enable` or install directly)
- Rust (stable, via [rustup](https://rustup.rs)) with the `clippy` component
- [Foundry](https://getfoundry.sh) (`forge`, `cast`, `anvil`) for `contracts/`

## Repository layout

See `docs/decisions/` for the architectural decisions (ADRs) behind this
structure and the versioned profile documents under `docs/` for the technical
specifications.

```
apps/          TypeScript services (api, coordinator, anchor-service, explorer, demo-reference)
               + the Rust validator service (apps/validator)
packages/      Shared libraries — canonical-json and crypto ship both a
               TypeScript (ts/) and a Rust (rust/) implementation, verified
               against each other via shared test vectors
policies/      Versioned decision policies, written in Rust, compiled to WASM
contracts/     Foundry project (Solidity)
infra/         Dockerfiles for reproducible and isolated build profiles
docs/          Architecture notes and ADRs
```

## Setup

```bash
pnpm install
```

## Common commands

```bash
pnpm build       # turbo run build — all TypeScript packages/apps
pnpm lint        # turbo run lint
pnpm test        # turbo run test
pnpm typecheck   # turbo run typecheck

cargo build --workspace
cargo test --workspace --exclude ddn-validator   # ddn-validator's tests need the policy package built first, below
cargo clippy --workspace --all-targets -- -D warnings

cd contracts && forge build && forge test && forge fmt --check
```

### Building and verifying the negotiation-v1 policy package

`policies/*/package/` (the WASM binary + manifest that `ddn-validator`
consumes) is a build artifact, not checked in — regenerate it before
running `ddn-validator`'s tests or the CLI directly:

```bash
pnpm run build:policy          # ./scripts/build-policy.sh — builds policy.wasm + manifest.json
pnpm run test:vectors          # cross-language + native-vs-WASM vector tests, all languages
pnpm run test:determinism      # 1000 identical runs against the same input
pnpm run policy:reproducibility # two independent Docker builds must produce the same policy.wasm hash
pnpm run verify:milestone-2    # all of the above, plus the full TS/Rust/Solidity suites, in one command
```

See `docs/execution-profile-v1.md`, `docs/reproducible-builds.md`, and
`docs/milestone-2-verification.md`.

### Public explorer and synthetic negotiation reference

`apps/explorer` and `apps/demo-negotiation-reference` both need a running `apps/api`
(with real validator instances and, for anchoring, a real Anvil chain) to
be more than a "not configured" placeholder — see `docs/public-demo-boundary.md`
for the full env-var reference and a worked local setup. Both apps must
be run as real production builds (`next build && next start`, not `next
dev`) to match what CI and the real E2E suite actually exercise.

```bash
pnpm --filter @ddn/explorer run test:a11y        # axe-core accessibility scan
pnpm --filter @ddn/demo-negotiation-reference run test:a11y  # axe-core accessibility scan
pnpm --filter @ddn/e2e run test:e2e              # real, no-mocks browser <-> API <-> validators <-> receipt <-> anchoring E2E
```

The accessibility suites boot each app on its own and need no live
`apps/api`. The real E2E suite is fully self-contained: it builds the
validator binary, WASM policy, and contract artifact if needed, spawns
its own Anvil node and `apps/api` process, and tears everything down
afterward — see `docs/public-demo-boundary.md`'s "Running the real E2E".

## Determinism is the point

This project's core guarantee is that independent operators, running the
same versioned policy, reach the same result. When touching anything under
`packages/canonical-json`, `packages/crypto`, or `policies/`:

- Never introduce non-determinism (system clock, RNG, floating point in
  consensus-affecting paths, iteration order that depends on hash-map
  internals).
- If you change a canonicalization or hashing rule, regenerate and re-verify
  every affected test vector — a silent hash drift is a correctness bug,
  not a style issue.
- A TypeScript change to `canonical-json`/`crypto` needs a matching Rust
  change (and vice versa), proven by the cross-language test vectors, not
  just "looks equivalent."

## Commit style

Commit messages: one line summarizing *what* changed, blank line, then
*why* if it's not obvious from the diff alone. Reference the relevant public
ADR, protocol profile, test plan or release gate when the commit completes or
advances one.

## Before opening a PR

- `pnpm run verify:milestone-2` runs everything below in one command.
- `pnpm build && pnpm lint && pnpm test && pnpm typecheck` (TypeScript)
- `cargo build --workspace && cargo test --workspace --exclude ddn-validator && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all -- --check` (Rust)
- `pnpm run build:policy && cargo test -p ddn-validator` (WASM build + cross-language/native-vs-WASM vectors, if you touched `policies/`, `packages/canonical-json`, `packages/crypto`, or `apps/validator`)
- `cd contracts && forge build && forge test && forge fmt --check` (Solidity, if touched)
- `pnpm --filter @ddn/e2e run test:e2e` (the real E2E, if you touched `apps/explorer`, `apps/demo-negotiation-reference`, `@ddn/demo-web-kit`, `@ddn/receipt-ui`, `@ddn/demo-trust-profile`, or `apps/api`'s auth/decision/anchor routes)
- CI must be green before merge — see `.github/workflows/ci.yml`. The `real-e2e` job is blocking, same as every other job in that file.
