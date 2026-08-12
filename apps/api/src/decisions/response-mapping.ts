// SPDX-License-Identifier: Apache-2.0
// Maps an internal DecisionRecord to the public DecisionStatusResponseV1
// (api-v1.ts) -- the one response shape used by both POST /v1/decisions
// and GET /v1/decisions/{decisionId}. See types.ts for why the internal
// record carries more (tenantId, raw input, the full DecisionReceiptV1)
// than this ever exposes.

import type { DecisionStatusResponseV1 } from '@ddn/schemas';
import { ApiError } from '../errors/api-error.js';
import type { DecisionRecord } from './types.js';

const SCHEMA_VERSION = '1.0.0';

export function toDecisionStatusResponse(record: DecisionRecord): DecisionStatusResponseV1 {
  switch (record.status) {
    case 'PENDING':
    case 'RUNNING':
      return {
        schemaVersion: SCHEMA_VERSION,
        decisionId: record.decisionId,
        status: record.status,
        submittedAt: record.submittedAt,
        updatedAt: record.updatedAt,
      };
    case 'FINALIZED':
      return {
        schemaVersion: SCHEMA_VERSION,
        decisionId: record.decisionId,
        status: 'FINALIZED',
        result: record.result,
        verification: {
          receiptId: record.receipt.receiptId,
          validatorSetId: record.receipt.quorum.validatorSetId,
          matchingValidators: record.receipt.signedResults.length,
          requiredQuorum: record.receipt.quorum.threshold,
          policyHash: record.receipt.consensus.policyHash,
          profileHash: record.receipt.consensus.profileHash,
          inputHash: record.receipt.consensus.inputHash,
          outputHash: record.receipt.consensus.outputHash,
          executionHash: record.receipt.consensus.executionHash,
        },
        submittedAt: record.submittedAt,
        finalizedAt: record.finalizedAt,
      };
    case 'NO_QUORUM':
    case 'FAILED':
      return {
        schemaVersion: SCHEMA_VERSION,
        decisionId: record.decisionId,
        status: record.status,
        error: record.error,
        submittedAt: record.submittedAt,
        updatedAt: record.updatedAt,
      };
  }
}

/** The policy output is a CanonicalJsonValue (any JSON shape); every
 * policy currently registered (negotiation-v1) always produces an object,
 * and DecisionFinalizedResponseV1.result is typed as one -- fails loudly
 * rather than silently reshaping an unexpected output into `{}`. */
export function extractResultObject(output: unknown): Record<string, unknown> {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    throw new ApiError('INTERNAL_ERROR', 'policy output was not a JSON object');
  }
  return output as Record<string, unknown>;
}
