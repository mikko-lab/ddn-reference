// SPDX-License-Identifier: Apache-2.0
// Strictly validated boot-time configuration. A missing/invalid critical
// value throws before the server ever starts listening -- see
// docs/api-security-model.md: no silent defaults for the validator
// binary, policy package, validator set, service tokens, execution
// profile, or CORS origins.

import { SERVICE_ROLES, type ServiceRole } from './auth/types.js';

export interface ServiceTokenConfig {
  readonly token: string;
  readonly tokenId: string;
  readonly tenantId: string;
  readonly roles: readonly ServiceRole[];
}

/** One isolated validator instance's key file paths -- the coordinator
 * (here, the decision runner) needs these paths to invoke each instance's
 * own `ddn-validator execute --private-key-file ...`; the private key
 * itself is only ever read by that instance's own child process, never
 * loaded into this process's memory. See docs/decision-receipt-v1.md's
 * "three isolated validator instances" model. */
export interface ValidatorInstancePathConfig {
  readonly privateKeyFilePath: string;
  readonly publicKeyFilePath: string;
}

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly maxRequestBytes: number;
  readonly decisionTimeoutMs: number;
  readonly maxConcurrentDecisions: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly validatorBinaryPath: string;
  readonly policyRegistryPath: string;
  readonly executionProfilePath: string;
  readonly validatorSetPath: string;
  readonly validatorInstances: readonly ValidatorInstancePathConfig[];
  readonly serviceTokens: readonly ServiceTokenConfig[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new ConfigError(`missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInt(env: NodeJS.ProcessEnv, name: string, fallback?: number): number {
  const raw = env[name];
  if (raw === undefined) {
    if (fallback === undefined) throw new ConfigError(`missing required environment variable: ${name}`);
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

/** DDN_SERVICE_TOKENS is a JSON array of ServiceTokenConfig, e.g.
 * `[{"token":"...","tokenId":"tok_a","tenantId":"tenant-a","roles":["decision:submit","decision:read","receipt:verify","policy:read"]}]`.
 * Deliberately not a simpler "comma-separated token=tenant" format:
 * roles need to be an explicit list per token, and a JSON array keeps
 * that structured rather than inventing a second, ad hoc encoding. */
function parseServiceTokens(env: NodeJS.ProcessEnv): readonly ServiceTokenConfig[] {
  const raw = requireEnv(env, 'DDN_SERVICE_TOKENS');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('DDN_SERVICE_TOKENS must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ConfigError('DDN_SERVICE_TOKENS must be a non-empty JSON array');
  }
  const seenTokenIds = new Set<string>();
  return parsed.map((entry, index): ServiceTokenConfig => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ConfigError(`DDN_SERVICE_TOKENS[${index}] must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    const token = obj.token;
    const tokenId = obj.tokenId;
    const tenantId = obj.tenantId;
    const roles = obj.roles;
    if (typeof token !== 'string' || token.length < 16) {
      throw new ConfigError(`DDN_SERVICE_TOKENS[${index}].token must be a string of at least 16 characters`);
    }
    if (typeof tokenId !== 'string' || tokenId.length === 0) {
      throw new ConfigError(`DDN_SERVICE_TOKENS[${index}].tokenId must be a non-empty string`);
    }
    if (seenTokenIds.has(tokenId)) {
      throw new ConfigError(`DDN_SERVICE_TOKENS contains a duplicate tokenId: ${tokenId}`);
    }
    seenTokenIds.add(tokenId);
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      throw new ConfigError(`DDN_SERVICE_TOKENS[${index}].tenantId must be a non-empty string`);
    }
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => (SERVICE_ROLES as readonly string[]).includes(r))) {
      throw new ConfigError(`DDN_SERVICE_TOKENS[${index}].roles must be a non-empty array of valid role strings`);
    }
    return { token, tokenId, tenantId, roles: roles as ServiceTokenConfig['roles'] };
  });
}

/** DDN_VALIDATOR_INSTANCES is a JSON array of ValidatorInstancePathConfig,
 * e.g. `[{"privateKeyFilePath":"/keys/a.key","publicKeyFilePath":"/keys/a.pub"}, ...]`.
 * A single JSON array (rather than two separately-ordered comma lists)
 * so a private/public key pair can never be silently misaligned by index. */
function parseValidatorInstances(env: NodeJS.ProcessEnv): readonly ValidatorInstancePathConfig[] {
  const raw = requireEnv(env, 'DDN_VALIDATOR_INSTANCES');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('DDN_VALIDATOR_INSTANCES must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ConfigError('DDN_VALIDATOR_INSTANCES must be a non-empty JSON array');
  }
  return parsed.map((entry, index): ValidatorInstancePathConfig => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ConfigError(`DDN_VALIDATOR_INSTANCES[${index}] must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    const privateKeyFilePath = obj.privateKeyFilePath;
    const publicKeyFilePath = obj.publicKeyFilePath;
    if (typeof privateKeyFilePath !== 'string' || privateKeyFilePath.length === 0) {
      throw new ConfigError(`DDN_VALIDATOR_INSTANCES[${index}].privateKeyFilePath must be a non-empty string`);
    }
    if (typeof publicKeyFilePath !== 'string' || publicKeyFilePath.length === 0) {
      throw new ConfigError(`DDN_VALIDATOR_INSTANCES[${index}].publicKeyFilePath must be a non-empty string`);
    }
    return { privateKeyFilePath, publicKeyFilePath };
  });
}

function parseCorsOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = requireEnv(env, 'DDN_CORS_ALLOWED_ORIGINS');
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (origins.length === 0) {
    throw new ConfigError('DDN_CORS_ALLOWED_ORIGINS must contain at least one origin (comma-separated)');
  }
  return origins;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.DDN_API_HOST ?? '127.0.0.1',
    port: parsePositiveInt(env, 'DDN_API_PORT'),
    maxRequestBytes: parsePositiveInt(env, 'DDN_API_MAX_REQUEST_BYTES', 20_000),
    decisionTimeoutMs: parsePositiveInt(env, 'DDN_API_DECISION_TIMEOUT_MS', 30_000),
    maxConcurrentDecisions: parsePositiveInt(env, 'DDN_API_MAX_CONCURRENT_DECISIONS', 50),
    corsAllowedOrigins: parseCorsOrigins(env),
    validatorBinaryPath: requireEnv(env, 'DDN_VALIDATOR_BIN'),
    policyRegistryPath: requireEnv(env, 'DDN_POLICY_REGISTRY_PATH'),
    executionProfilePath: requireEnv(env, 'DDN_EXECUTION_PROFILE_PATH'),
    validatorSetPath: requireEnv(env, 'DDN_VALIDATOR_SET_PATH'),
    validatorInstances: parseValidatorInstances(env),
    serviceTokens: parseServiceTokens(env),
  };
}
