// SPDX-License-Identifier: Apache-2.0
import 'server-only';
// The one fixed, server-side-only DDN service token
// this BFF proxies with -- configured for exactly one non-production demo
// tenant, never a per-visitor credential, never sent to or readable by the
// browser. The `server-only` import above makes this a build-time error
// if ever imported from a Client Component, not just a convention.
//
// This BFF is explicitly for the public demo, not a general-purpose
// authentication or authorization solution. Real application data requires
// a deployment-specific identity and authorization boundary.
//
// Fails closed: if either env var is unset, getDemoBffClient() returns
// undefined and every route handler responds 503 SERVICE_UNAVAILABLE
// rather than silently falling back to an unauthenticated call or a
// default backend. The actual "is this configured" decision lives in
// ../lib/demo-bff-env.ts (no server-only import) so it's directly
// unit-testable; this file only wires that decision to a real DdnClient.

import { DdnClient } from '@ddn/client-sdk';
import { readDemoBffEnvConfig } from '../lib/demo-bff-env';

let cachedClient: DdnClient | undefined;
let attemptedConfig = false;

export function getDemoBffClient(): DdnClient | undefined {
  if (attemptedConfig) return cachedClient;
  attemptedConfig = true;
  const config = readDemoBffEnvConfig(process.env);
  if (!config) return undefined;
  cachedClient = new DdnClient({ baseUrl: config.baseUrl, serviceToken: config.serviceToken });
  return cachedClient;
}

/** Test-only: clears the cached client/config-attempted flag so a test can
 * exercise getDemoBffClient() again under different process.env values. */
export function resetDemoBffClientForTests(): void {
  cachedClient = undefined;
  attemptedConfig = false;
}
