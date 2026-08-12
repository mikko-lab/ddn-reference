// SPDX-License-Identifier: Apache-2.0
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// See packages/schemas' own readJsonSchema for why this is a single-arg
// fileURLToPath(import.meta.url) plus plain node:path math rather than a
// two-argument `new URL(..., import.meta.url)` -- not strictly needed
// here since none of this ever runs through a bundler, but keeping the
// pattern uniform across the repo avoids relearning the caveat later.
// Compiled to dist/src/paths.js (tsconfig's rootDir is "." so tests/ and
// playwright.config.ts can be included too) -- three levels up from
// there, not two, reaches the repo root.
export const E2E_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = resolve(E2E_DIR, '..');

export const VALIDATOR_BINARY_PATH = join(REPO_ROOT, 'target/release/ddn-validator');
export const POLICY_PACKAGE_DIR = join(REPO_ROOT, 'policies/negotiation-v1/package');
export const POLICY_REGISTRY_PATH = join(REPO_ROOT, 'policies/registry.json');
export const EXECUTION_PROFILE_PATH = join(REPO_ROOT, 'packages/config/profiles/ddn-wasm-v1.json');
export const CONTRACT_ARTIFACT_PATH = join(REPO_ROOT, 'contracts/out/DecisionAnchor.sol/DecisionAnchor.json');

export const API_APP_DIR = join(REPO_ROOT, 'apps/api');
export const API_SERVER_ENTRYPOINT = join(API_APP_DIR, 'dist/server.js');
export const EXPLORER_APP_DIR = join(REPO_ROOT, 'apps/explorer');
export const DEMO_REFERENCE_APP_DIR = join(REPO_ROOT, 'apps/demo-negotiation-reference');
