// SPDX-License-Identifier: Apache-2.0
// Service-token lookup. Deliberately scans every configured token instead
// of indexing by the raw token value (a Map keyed on the secret itself
// would make lookup cost depend on which token matched) and compares
// fixed-length SHA-256 fingerprints via timingSafeEqual rather than the
// variable-length token strings, so neither which token matched nor
// whether any of them did is observable via timing.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiConfig, ServiceTokenConfig } from '../config.js';
import type { ServiceTokenPrincipal } from './types.js';

function fingerprint(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function tokensMatch(presented: Buffer, configured: string): boolean {
  return timingSafeEqual(presented, fingerprint(configured));
}

export function findServiceTokenPrincipal(config: ApiConfig, presentedToken: string): ServiceTokenPrincipal | undefined {
  const presentedFingerprint = fingerprint(presentedToken);
  let match: ServiceTokenConfig | undefined;
  for (const candidate of config.serviceTokens) {
    if (tokensMatch(presentedFingerprint, candidate.token)) {
      match = candidate;
    }
  }
  if (!match) return undefined;
  return { tokenId: match.tokenId, tenantId: match.tenantId, roles: match.roles };
}
