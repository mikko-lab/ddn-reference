// SPDX-License-Identifier: Apache-2.0
import 'server-only';
// Milestone 7: the demo-reference offer flow's own server-side-only DDN
// service token, separate from apps/explorer's DDN_DEMO_SERVICE_TOKEN.
// Never sent to or readable by the browser. See
// docs/public-demo-boundary.md.

import { DdnClient } from '@ddn/client-sdk';
import { readReferenceEnvConfig } from '../lib/reference-bff-env';

let cachedClient: DdnClient | undefined;
let attemptedConfig = false;

export function getReferenceBffClient(): DdnClient | undefined {
  if (attemptedConfig) return cachedClient;
  attemptedConfig = true;
  const config = readReferenceEnvConfig(process.env);
  if (!config) return undefined;
  cachedClient = new DdnClient({ baseUrl: config.baseUrl, serviceToken: config.serviceToken });
  return cachedClient;
}
