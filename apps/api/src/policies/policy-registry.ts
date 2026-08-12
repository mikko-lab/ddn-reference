// SPDX-License-Identifier: Apache-2.0
// Loads the policy registry (DDN_POLICY_REGISTRY_PATH): the list of
// (policyId, policyVersion) pairs this deployment will accept decisions
// for, and where each one's policy package lives on disk. Paths in the
// registry file are resolved relative to the registry file's own
// directory, not the process cwd, so the file stays portable regardless
// of where the API is launched from.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PolicyRefV1 } from '@ddn/schemas';
import { ApiError } from '../errors/api-error.js';

export type PolicyRegistryStatus = 'ACTIVE' | 'INACTIVE';

export interface PolicyRegistryEntry {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyPackagePath: string;
  readonly status: PolicyRegistryStatus;
}

export interface PolicyRegistry {
  readonly entries: readonly PolicyRegistryEntry[];
}

export class PolicyRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyRegistryError';
  }
}

export function loadPolicyRegistry(registryPath: string): PolicyRegistry {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new PolicyRegistryError(`failed to read/parse policy registry at ${registryPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Record<string, unknown>).policies)) {
    throw new PolicyRegistryError(`${registryPath}: expected an object with a "policies" array`);
  }
  const baseDir = dirname(registryPath);
  const seen = new Set<string>();
  const entries = ((raw as Record<string, unknown>).policies as unknown[]).map((entry, index): PolicyRegistryEntry => {
    if (typeof entry !== 'object' || entry === null) {
      throw new PolicyRegistryError(`${registryPath}: policies[${index}] must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    const policyId = obj.policyId;
    const policyVersion = obj.policyVersion;
    const policyPackagePath = obj.policyPackagePath;
    const status = obj.status;
    if (typeof policyId !== 'string' || policyId.length === 0) {
      throw new PolicyRegistryError(`${registryPath}: policies[${index}].policyId must be a non-empty string`);
    }
    if (typeof policyVersion !== 'string' || policyVersion.length === 0) {
      throw new PolicyRegistryError(`${registryPath}: policies[${index}].policyVersion must be a non-empty string`);
    }
    const key = `${policyId}@${policyVersion}`;
    if (seen.has(key)) {
      throw new PolicyRegistryError(`${registryPath}: duplicate policy entry for ${key}`);
    }
    seen.add(key);
    if (typeof policyPackagePath !== 'string' || policyPackagePath.length === 0) {
      throw new PolicyRegistryError(`${registryPath}: policies[${index}].policyPackagePath must be a non-empty string`);
    }
    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      throw new PolicyRegistryError(`${registryPath}: policies[${index}].status must be "ACTIVE" or "INACTIVE"`);
    }
    return { policyId, policyVersion, policyPackagePath: resolve(baseDir, policyPackagePath), status };
  });
  return { entries };
}

/** Looks up a policy by (policyId, policyVersion) and requires it to be
 * ACTIVE. POLICY_NOT_FOUND for an unregistered pair, POLICY_NOT_ACTIVE for
 * a registered-but-disabled one -- kept distinct because a client should
 * be able to tell "this will never exist" from "this existed and was
 * retired," per the ApiErrorCode list. */
export function requireActivePolicy(registry: PolicyRegistry, ref: PolicyRefV1): PolicyRegistryEntry {
  const entry = registry.entries.find((e) => e.policyId === ref.policyId && e.policyVersion === ref.policyVersion);
  if (!entry) {
    throw new ApiError('POLICY_NOT_FOUND', `no policy registered for ${ref.policyId}@${ref.policyVersion}`);
  }
  if (entry.status !== 'ACTIVE') {
    throw new ApiError('POLICY_NOT_ACTIVE', `policy ${ref.policyId}@${ref.policyVersion} is not ACTIVE`);
  }
  return entry;
}
