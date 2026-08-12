// SPDX-License-Identifier: Apache-2.0
// Loads and integrity-checks the one committed, bundled TrustedDemoProfileV1
// -- the single function apps/demo-negotiation-reference's server side and the local
// stack's bootstrap script should all use to obtain the trust anchor. There
// is no user-supplied override path in M7 (see docs/public-demo-boundary.md).
//
// Node-only (node:fs) -- apps/explorer's client-side code must import
// assertProfileIntegrity from browser.ts instead, never this file.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrustedDemoProfileV1, type TrustedDemoProfileV1 } from './trusted-demo-profile.js';
import { assertProfileIntegrity } from './load-profile-integrity.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TRUSTED_DEMO_PROFILE_PATH = join(PACKAGE_ROOT, 'profile/trusted-demo-profile.json');

export { assertProfileIntegrity } from './load-profile-integrity.js';

/** Parses the committed profile and checks its integrity (see
 * assertProfileIntegrity) before returning it. */
export function loadBundledTrustedDemoProfile(): TrustedDemoProfileV1 {
  const raw = readFileSync(TRUSTED_DEMO_PROFILE_PATH, 'utf8');
  const profile = parseTrustedDemoProfileV1(JSON.parse(raw));
  assertProfileIntegrity(profile);
  return profile;
}
