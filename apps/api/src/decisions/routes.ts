// SPDX-License-Identifier: Apache-2.0
// HTTP routes for POST /v1/decisions, GET /v1/decisions/{decisionId},
// GET /v1/decisions/{decisionId}/receipt, GET /v1/decisions/{decisionId}/anchor,
// and GET /v1/decisions/{decisionId}/validators (Milestone 7). All
// request-shape validation happens via parseSubmitDecisionRequestV1 before
// any of this handler's own logic runs; the decision itself is executed
// asynchronously (see process-decision.ts) so this handler only ever
// creates/reads records.

import type { FastifyInstance } from 'fastify';
import { parseSubmitDecisionRequestV1, SchemaValidationError, validateNegotiationInputV1 } from '@ddn/schemas';
import { getPrincipal, requireAuth } from '../auth/authenticate.js';
import { reconcileTenantId } from '../auth/tenant-context.js';
import type { AppDependencies } from '../dependencies.js';
import { ApiError } from '../errors/api-error.js';
import { requireActivePolicy } from '../policies/policy-registry.js';
import { requireMatchingVerificationProfile } from '../policies/verification-profile.js';
import { computeIdempotencyRequestHash } from './idempotency.js';
import { generateDecisionId } from './id.js';
import { processDecision } from './process-decision.js';
import { toDecisionStatusResponse } from './response-mapping.js';
import type { PendingDecisionRecord } from './types.js';

export function registerDecisionRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/v1/decisions', { preHandler: requireAuth(deps.config, ['decision:submit']) }, async (req, reply) => {
    const body = parseSubmitDecisionRequestV1(req.body);
    const principal = getPrincipal(req);
    const reconciledInput = reconcileTenantId(body.input, principal);

    try {
      validateNegotiationInputV1(reconciledInput);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new ApiError('INVALID_REQUEST', error.message, [{ code: error.code }]);
      }
      throw error;
    }

    requireActivePolicy(deps.policyRegistry, body.policy);
    requireMatchingVerificationProfile(deps.verificationProfile, body.verificationProfileId);

    const idempotencyRequestHash = computeIdempotencyRequestHash({
      tenantId: principal.tenantId,
      policy: body.policy,
      input: reconciledInput,
      verificationProfileId: body.verificationProfileId,
    });

    let wasCreated = false;
    const submittedAt = new Date().toISOString();
    const record = await deps.decisionRepository.createOrGetByIdempotencyKey(principal.tenantId, idempotencyRequestHash, () => {
      wasCreated = true;
      const pending: PendingDecisionRecord = {
        decisionId: generateDecisionId(),
        tenantId: principal.tenantId,
        policy: body.policy,
        input: reconciledInput,
        verificationProfileId: body.verificationProfileId,
        idempotencyRequestHash,
        submittedAt,
        updatedAt: submittedAt,
        status: 'PENDING',
      };
      return pending;
    });

    if (wasCreated && record.status === 'PENDING') {
      void processDecision(deps, record);
    }

    reply.status(wasCreated ? 201 : 200).send(toDecisionStatusResponse(record));
  });

  app.get<{ Params: { decisionId: string } }>(
    '/v1/decisions/:decisionId',
    { preHandler: requireAuth(deps.config, ['decision:read']) },
    async (req) => {
      const principal = getPrincipal(req);
      const record = await deps.decisionRepository.get(req.params.decisionId);
      // A decision belonging to a different tenant is reported identically
      // to one that doesn't exist -- never confirm another tenant's
      // decisionId is valid.
      if (!record || record.tenantId !== principal.tenantId) {
        throw new ApiError('DECISION_NOT_FOUND', `no decision found for id: ${req.params.decisionId}`);
      }
      return toDecisionStatusResponse(record);
    }
  );

  app.get<{ Params: { decisionId: string } }>(
    '/v1/decisions/:decisionId/receipt',
    { preHandler: requireAuth(deps.config, ['decision:read']) },
    async (req) => {
      const principal = getPrincipal(req);
      const record = await deps.decisionRepository.get(req.params.decisionId);
      if (!record || record.tenantId !== principal.tenantId) {
        throw new ApiError('DECISION_NOT_FOUND', `no decision found for id: ${req.params.decisionId}`);
      }
      if (record.status !== 'FINALIZED') {
        throw new ApiError('RECEIPT_NOT_AVAILABLE', `decision ${req.params.decisionId} has not been finalized`);
      }
      return record.receipt;
    }
  );

  app.get<{ Params: { decisionId: string } }>(
    '/v1/decisions/:decisionId/anchor',
    { preHandler: requireAuth(deps.config, ['decision:read']) },
    async (req) => {
      const principal = getPrincipal(req);
      const record = await deps.decisionRepository.get(req.params.decisionId);
      if (!record || record.tenantId !== principal.tenantId) {
        throw new ApiError('DECISION_NOT_FOUND', `no decision found for id: ${req.params.decisionId}`);
      }
      // Keyed by receiptId in the sidecar store, addressed by decisionId
      // here -- matches /receipt's own tenant-isolation check exactly.
      // Only ever returned once the anchor sidecar reaches CONFIRMED;
      // every earlier state (or no entry at all, e.g. not yet FINALIZED)
      // reports the same ANCHOR_NOT_AVAILABLE, never the sidecar's
      // internal status or any chain/RPC diagnostic detail.
      const entry = deps.anchorSidecarStore.getByDecisionId(req.params.decisionId);
      if (!entry || entry.status !== 'CONFIRMED' || !entry.anchorRecord) {
        throw new ApiError('ANCHOR_NOT_AVAILABLE', `decision ${req.params.decisionId} has not been anchored yet`);
      }
      return entry.anchorRecord;
    }
  );

  app.get<{ Params: { decisionId: string } }>(
    '/v1/decisions/:decisionId/validators',
    { preHandler: requireAuth(deps.config, ['decision:read']) },
    async (req) => {
      const principal = getPrincipal(req);
      const record = await deps.decisionRepository.get(req.params.decisionId);
      if (!record || record.tenantId !== principal.tenantId) {
        throw new ApiError('DECISION_NOT_FOUND', `no decision found for id: ${req.params.decisionId}`);
      }
      // An empty array (decision exists but hasn't started running
      // validators yet, still PENDING) is a valid, non-error response --
      // matches ValidatorProgressStore.get's own "undefined means not
      // registered yet" contract exactly.
      const validators = deps.validatorProgressStore.get(req.params.decisionId) ?? [];
      return { schemaVersion: '1.0.0', decisionId: req.params.decisionId, validators };
    }
  );
}
