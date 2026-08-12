// SPDX-License-Identifier: Apache-2.0
// Pure fail-closed config check for the demo BFF -- split out of
// server/demo-bff-config.ts (which carries a `server-only` import) so
// this specific decision ("are both required env vars present") is
// directly unit-testable. `server-only`'s default export throws
// unconditionally outside a real Next.js server context, so anything
// importing it cannot be exercised by a plain node:test run.

export interface DemoBffEnvConfig {
  readonly baseUrl: string;
  readonly serviceToken: string;
}

export function readDemoBffEnvConfig(env: Readonly<Partial<Record<string, string>>>): DemoBffEnvConfig | undefined {
  const baseUrl = env.DDN_API_BASE_URL;
  const serviceToken = env.DDN_DEMO_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) {
    return undefined;
  }
  return { baseUrl, serviceToken };
}
