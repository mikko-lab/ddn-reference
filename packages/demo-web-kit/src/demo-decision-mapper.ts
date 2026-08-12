// SPDX-License-Identifier: Apache-2.0
// Pure mappers from @ddn/schemas' wire types to this app's own demo DTOs
// (src/lib/demo-decision-dto.ts) -- every field is named explicitly, never
// a `...spread`, so an upstream response gaining a field (e.g. tenantId)
// can never silently start reaching the browser through this boundary.

import type { DecisionStatusResponseV1, ValidatorProgressResponseV1 } from '@ddn/schemas';
import type { AnchorRecordV1, DecisionReceiptV1 } from '@ddn/receipt-sdk';
import type {
  DemoAnchorDto,
  DemoDecisionStatusDto,
  DemoReceiptDto,
  DemoValidatorPhaseDto,
  DemoValidatorProgressDto,
} from './demo-decision-dto.js';

export function toDemoDecisionStatusDto(response: DecisionStatusResponseV1): DemoDecisionStatusDto {
  if (response.status === 'FINALIZED') {
    return {
      decisionId: response.decisionId,
      status: 'FINALIZED',
      submittedAt: response.submittedAt,
      finalizedAt: response.finalizedAt,
      result: response.result,
      verification: {
        receiptId: response.verification.receiptId,
        validatorSetId: response.verification.validatorSetId,
        matchingValidators: response.verification.matchingValidators,
        requiredQuorum: response.verification.requiredQuorum,
        policyHash: response.verification.policyHash,
        profileHash: response.verification.profileHash,
        inputHash: response.verification.inputHash,
        outputHash: response.verification.outputHash,
        executionHash: response.verification.executionHash,
      },
    };
  }
  if (response.status === 'NO_QUORUM' || response.status === 'FAILED') {
    return {
      decisionId: response.decisionId,
      status: response.status,
      submittedAt: response.submittedAt,
      updatedAt: response.updatedAt,
      error: { code: response.error.code, message: response.error.message },
    };
  }
  return {
    decisionId: response.decisionId,
    status: response.status,
    submittedAt: response.submittedAt,
    updatedAt: response.updatedAt,
  };
}

export function toDemoValidatorProgressDto(decisionId: string, response: ValidatorProgressResponseV1): DemoValidatorProgressDto {
  return {
    decisionId,
    validators: response.validators.map((v) => ({
      validatorId: v.validatorId,
      phase: v.phase,
      updatedAt: v.updatedAt,
      ...(v.outputHash !== undefined ? { outputHash: v.outputHash } : {}),
    })),
  };
}

export function toDemoReceiptDto(decisionId: string, receipt: DecisionReceiptV1 | undefined): DemoReceiptDto {
  return { decisionId, receipt };
}

export function toDemoAnchorDto(decisionId: string, anchor: AnchorRecordV1 | undefined): DemoAnchorDto {
  return { decisionId, anchor };
}

/** All terminal validator phases -- used to decide when a client should
 * stop polling /validators. */
export function isTerminalValidatorPhase(phase: DemoValidatorPhaseDto): boolean {
  return phase === 'SUCCEEDED' || phase === 'FAILED' || phase === 'TIMED_OUT';
}

export function isTerminalDecisionStatus(status: DemoDecisionStatusDto['status']): boolean {
  return status === 'FINALIZED' || status === 'NO_QUORUM' || status === 'FAILED';
}
