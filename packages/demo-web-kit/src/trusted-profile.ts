// SPDX-License-Identifier: Apache-2.0
// Bundles the committed TrustedDemoProfileV1 directly into the explorer's
// client-side JavaScript via a static JSON import (resolved and inlined by
// the bundler at build time) -- not read from disk at runtime, since
// @ddn/demo-trust-profile's own loadBundledTrustedDemoProfile uses
// node:fs and only runs server-side. Re-validated here (parse + integrity
// check) so a corrupted bundle is still caught at runtime, not just at
// generation time. There is no user-supplied override in M7.
//
// Imports from @ddn/demo-trust-profile/browser (not the package root) --
// that entry point never pulls in the Node-only (node:fs) modules the
// package root re-exports.

import { assertProfileIntegrity, parseTrustedDemoProfileV1, type TrustedDemoProfileV1 } from '@ddn/demo-trust-profile/browser';
import trustedDemoProfileJson from '@ddn/demo-trust-profile/profile/trusted-demo-profile.json' with { type: 'json' };

let cached: TrustedDemoProfileV1 | undefined;

export function parseTrustedProfileSource(runtimeJson: string | undefined): TrustedDemoProfileV1 {
  let source: unknown = trustedDemoProfileJson;
  if (runtimeJson) {
    try {
      source = JSON.parse(runtimeJson);
    } catch {
      throw new Error('NEXT_PUBLIC_DDN_TRUSTED_PROFILE_JSON is not valid JSON');
    }
  }
  const profile = parseTrustedDemoProfileV1(source);
  assertProfileIntegrity(profile);
  return profile;
}

export function getTrustedDemoProfile(): TrustedDemoProfileV1 {
  if (!cached) {
    cached = parseTrustedProfileSource(process.env.NEXT_PUBLIC_DDN_TRUSTED_PROFILE_JSON);
  }
  return cached;
}
