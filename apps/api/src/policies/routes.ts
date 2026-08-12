// SPDX-License-Identifier: Apache-2.0
// GET /v1/policies and GET /v1/policies/{policyId}/{policyVersion}.
// policyHash/profileHash are computed the same way ddn-validator computes
// them (policy-hashes.ts), not read from any self-declared value in the
// registry file -- see policy-hashes.ts.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/authenticate.js';
import type { AppDependencies } from '../dependencies.js';
import { ApiError } from '../errors/api-error.js';
import { computePolicyHash, computeProfileHash } from './policy-hashes.js';

interface ReasonCodesFile {
  readonly reasonCodes: readonly string[];
}

export function registerPolicyRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.get('/v1/policies', { preHandler: requireAuth(deps.config, ['policy:read']) }, async () => {
    const profileHash = await computeProfileHash(deps.verificationProfile.profilePath);
    const policies = await Promise.all(
      deps.policyRegistry.entries.map(async (entry) => ({
        policyId: entry.policyId,
        policyVersion: entry.policyVersion,
        policyHash: await computePolicyHash(entry.policyPackagePath),
        profileHash,
        status: entry.status,
      }))
    );
    return { schemaVersion: '1.0.0', policies };
  });

  app.get<{ Params: { policyId: string; policyVersion: string } }>(
    '/v1/policies/:policyId/:policyVersion',
    { preHandler: requireAuth(deps.config, ['policy:read']) },
    async (req) => {
      const entry = deps.policyRegistry.entries.find(
        (e) => e.policyId === req.params.policyId && e.policyVersion === req.params.policyVersion
      );
      if (!entry) {
        throw new ApiError('POLICY_NOT_FOUND', `no policy registered for ${req.params.policyId}@${req.params.policyVersion}`);
      }

      const [policyHash, profileHash, inputSchema, outputSchema, reasonCodesFile] = await Promise.all([
        computePolicyHash(entry.policyPackagePath),
        computeProfileHash(deps.verificationProfile.profilePath),
        readFile(join(entry.policyPackagePath, 'input.schema.json'), 'utf8').then((t) => JSON.parse(t) as Record<string, unknown>),
        readFile(join(entry.policyPackagePath, 'output.schema.json'), 'utf8').then((t) => JSON.parse(t) as Record<string, unknown>),
        readFile(join(entry.policyPackagePath, 'reason-codes.json'), 'utf8').then((t) => JSON.parse(t) as ReasonCodesFile),
      ]);

      return {
        schemaVersion: '1.0.0',
        policyId: entry.policyId,
        policyVersion: entry.policyVersion,
        policyHash,
        profileHash,
        status: entry.status,
        inputSchema,
        outputSchema,
        reasonCodes: reasonCodesFile.reasonCodes,
      };
    }
  );
}
