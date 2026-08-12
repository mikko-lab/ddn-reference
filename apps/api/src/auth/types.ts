// SPDX-License-Identifier: Apache-2.0
// The four service-token roles this API recognizes, and the principal a
// successfully authenticated request carries downstream. Kept separate
// from config.ts so route/handler code depends on this file, not on the
// boot-time config-loading module.

export type ServiceRole = 'decision:submit' | 'decision:read' | 'receipt:verify' | 'policy:read';

export const SERVICE_ROLES: readonly ServiceRole[] = [
  'decision:submit',
  'decision:read',
  'receipt:verify',
  'policy:read',
];

export interface ServiceTokenPrincipal {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly roles: readonly ServiceRole[];
}
