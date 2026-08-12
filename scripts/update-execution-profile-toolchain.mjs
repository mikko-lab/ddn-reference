#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Merges a `toolchain` block into an execution profile JSON file, sourced
// from the environment (see scripts/policy-reproducibility.sh, which sets
// these right after a verified reproducible build). This keeps the
// profile's toolchain identity synced to whichever build actually produced
// the currently-committed policy.wasm — hand-typed constants would drift
// silently the next time a different architecture (or updated toolchain
// digest) produces the artifact. Any change here changes profileHash (see
// docs/execution-profile-v1.md), since apps/validator hashes the whole
// profile file — so the decision receipt is bound to this exact toolchain
// identity, not just to runtime config.
import { readFileSync, writeFileSync } from 'node:fs';

const profilePath = process.argv[2];
if (!profilePath) {
  console.error('usage: update-execution-profile-toolchain.mjs <profile.json>');
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

const profile = JSON.parse(readFileSync(profilePath, 'utf8'));

// Defense in depth: scripts/policy-reproducibility.sh already gates this
// call on the architecture lock before invoking this script, but this
// script can be run directly, so it re-checks rather than trusting the
// caller. The release artifact and profile are locked to one architecture
// (see docs/reproducible-builds.md#reproducibility-is-per-architecture) —
// a run on a different architecture must not silently overwrite them.
const incomingArch = required('DDN_RELEASE_BUILD_ARCHITECTURE');
const lockedArch = profile.toolchain?.releaseBuildArchitecture;
if (lockedArch && lockedArch !== incomingArch) {
  console.error(
    `refusing to overwrite: profile is locked to releaseBuildArchitecture ` +
      `"${lockedArch}", this run is "${incomingArch}". Run ` +
      `scripts/policy-reproducibility.sh directly (not this script) on a ` +
      `different architecture to get a cross-architecture validation ` +
      `result without touching the locked release profile.`,
  );
  process.exit(1);
}

profile.toolchain = {
  arch: required('DDN_TOOLCHAIN_ARCH'),
  releaseBuildArchitecture: required('DDN_RELEASE_BUILD_ARCHITECTURE'),
  rustcVersion: required('DDN_RUSTC_VERSION'),
  rustcCommitHash: required('DDN_RUSTC_COMMIT_HASH'),
  rustcHost: required('DDN_RUSTC_HOST'),
  rustcBinarySha256: required('DDN_RUSTC_BINARY_SHA256'),
  cargoBinarySha256: required('DDN_CARGO_BINARY_SHA256'),
  targetRustlibSha256: required('DDN_TARGET_RUSTLIB_SHA256'),
  muslLoaderSha256: required('DDN_MUSL_LOADER_SHA256'),
  libgccSSha256: required('DDN_LIBGCC_S_SHA256'),
  builderImageDigests: {
    toolchainSource: required('DDN_TOOLCHAIN_IMAGE'),
    builderA: required('DDN_BUILDER_A_BASE_IMAGE'),
    builderB: required('DDN_BUILDER_B_BASE_IMAGE'),
  },
  buildConfigurationSha256: required('DDN_BUILD_CONFIG_SHA256'),
};

writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');
console.log(`updated ${profilePath} with toolchain identity (arch: ${profile.toolchain.arch})`);
