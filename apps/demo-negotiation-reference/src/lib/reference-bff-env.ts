// SPDX-License-Identifier: Apache-2.0
// Pure fail-closed config check for the demo-reference offer flow --
// its own separate credential (DDN_DEMO_REFERENCE_SERVICE_TOKEN), never
// apps/explorer's DDN_DEMO_SERVICE_TOKEN reused. This surface needs both
// decision:submit (to place an offer)
// and decision:read (to poll/fetch its own result) roles on that token.

export interface ReferenceEnvConfig {
  readonly baseUrl: string;
  readonly serviceToken: string;
}

export function readReferenceEnvConfig(env: Readonly<Partial<Record<string, string>>>): ReferenceEnvConfig | undefined {
  const baseUrl = env.DDN_API_BASE_URL;
  const serviceToken = env.DDN_DEMO_REFERENCE_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) {
    return undefined;
  }
  return { baseUrl, serviceToken };
}
