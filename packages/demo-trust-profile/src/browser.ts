// SPDX-License-Identifier: Apache-2.0
// Milestone 7: the browser-safe subset of @ddn/demo-trust-profile --
// deliberately does NOT import load-profile.ts, deploy-and-verify.ts, or
// generate-trusted-demo-profile.ts, all of which use node:fs/
// node:child_process. apps/explorer's client-side verifier imports from
// this entry point (not the package root) so its bundle never pulls in
// Node-only code; the profile JSON itself is bundled separately via a
// static JSON import (see apps/explorer/src/lib/trusted-profile.ts).

export { parseTrustedDemoProfileV1, TrustedDemoProfileError } from './trusted-demo-profile.js';
export type { TrustedDemoProfileV1, TrustedDemoProfileChainV1, TrustedDemoProfileErrorCode } from './trusted-demo-profile.js';

export { assertProfileIntegrity } from './load-profile-integrity.js';

export { createDemoChainReader } from './chain-reader.js';
