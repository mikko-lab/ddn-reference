# Public snapshot manifest

The future `mikko-lab/ddn-reference` repository must be created from one
reviewed immutable source SHA as a new, private repository with a single
squashed initial commit. This document defines the component boundary; it is
not authorization to create or publish that repository.

## Allowed source boundary

- root build metadata and lockfiles explicitly listed by the positive
  allowlist in `public-snapshot-manifest.json`;
- `.github/workflows/` after immutable Action pin verification;
- generic reference components under `apps/`, `packages/`, `policies/`,
  `contracts/` and `e2e/` listed in the machine-readable manifest;
- public architecture, protocol, security, trust, limitation and reproduction
  documentation;
- scripts explicitly needed to build, verify, scan and reproduce the snapshot.

The pinned `forge-std` gitlink is materialized as ordinary vendored source at
the exact commit recorded in the machine manifest. The snapshot tool verifies
the superproject gitlink, source URL and local checkout before archiving that
commit without its `.git` history. The private repo's `.gitmodules` file is not
copied into the history-free snapshot.

## Always excluded

- the current `.git` directory and all existing commit history;
- `node_modules`, `target`, `dist`, `out`, caches, coverage, browser reports,
  downloaded tools and generated binaries;
- non-reference product code, customer or product integration material,
  deployment configuration and operational audit records;
- product-specific branded material and any customer data;
- authentication and application surfaces outside the two documented public
  reference applications;
- environment files, credentials, private keys and runtime-generated configs;
- workstation paths, private URLs and scanner raw findings.

The machine-readable manifest uses positive file and directory selection: it
does not enumerate the names of private source files. Committed deterministic
crypto/golden fixtures are allowed only at the exact test-only paths named by
that manifest. Every such file must say
`TEST-ONLY / NEVER USE IN PRODUCTION`; no directory-wide scanner suppression is
allowed. Secret-scanner exceptions for vendored upstream test vectors are
bound to one scanner, detector, file path, redacted SHA-256 fingerprint and
the vendored source commit. Upstream-only test suites are not copied into the
snapshot.

## Snapshot procedure

1. Record the reviewed source SHA and require a clean worktree.
2. Run `public-release-check` against that exact tree.
3. Copy only manifest-allowlisted paths into a new empty staging directory.
4. Confirm excluded/generated paths and `.git` are absent.
5. Run format, lint, typecheck, Rust/TypeScript/Solidity tests, Linux/arm64
   reproducibility, blocking no-mocks E2E, browser/axe checks, license reports,
   SBOM generation and two independently canary-tested secret scanners against
   the staging tree.
6. Review redacted outputs and resolve every mandatory failure.
7. Create a new Git repository and one squashed initial commit locally.
8. Create the destination repository as private only after a separate
   authorization. Push and public visibility each require later explicit GO
   decisions.

Local preparation can generate a CycloneDX 1.6 inventory with
`pnpm sbom -- /tmp/ddn-reference.cdx.json` and a redacted dependency-license
summary with `pnpm licenses:report -- /tmp/ddn-reference-licenses.json`.
These lockfile-derived reports complement, but do not replace, Gitleaks,
TruffleHog and an independent license-policy review of the final snapshot.

The Gitleaks gate uses the official macOS/arm64 Gitleaks 8.18.4 archive
(`SHA-256 a480d8593acd8215b22402cf0f3f88b01dcd3610c63b5391db640f7767e62104`).
The gate verifies the extracted binary hash and exact version, then requires a
positive GitHub-PAT canary and a negative control before scanning. Gitleaks
8.30.1 is not accepted because its default rules can silently miss that
positive canary.

The TruffleHog gate uses the official macOS/arm64 TruffleHog 3.96.0 archive
(`SHA-256 87478306b95ca2420cfb844b7582383ac60b922e262350a0088e797f328d2e62`).
It verifies the extracted binary hash and exact version, runs positive Infura
and negative controls, disables update and network verification, and includes
filtered-unverified results so the declared upstream Lob test vector cannot be
silently omitted.
