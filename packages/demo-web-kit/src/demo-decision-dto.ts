// SPDX-License-Identifier: Apache-2.0
// Purpose-built DTOs the demo BFF (see
// src/server/*) returns to the browser -- never the raw DDN API response
// passed through. Every field here is explicitly named by the mapper
// functions in src/server/demo-decision-mapper.ts (never a `...spread`),
// so an upstream schema gaining a new field (e.g. tenantId) can never
// silently start leaking through this boundary. See docs/public-demo-boundary.md.

import type { AnchorRecordV1, DecisionReceiptV1 } from '@ddn/receipt-sdk';

export interface DemoDecisionPendingDto {
  readonly decisionId: string;
  readonly status: 'PENDING' | 'RUNNING';
  readonly submittedAt: string;
  readonly updatedAt: string;
}

export interface DemoDecisionVerificationSummaryDto {
  readonly receiptId: string;
  readonly validatorSetId: string;
  readonly matchingValidators: number;
  readonly requiredQuorum: number;
  readonly policyHash: string;
  readonly profileHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly executionHash: string;
}

export interface DemoDecisionFinalizedDto {
  readonly decisionId: string;
  readonly status: 'FINALIZED';
  readonly submittedAt: string;
  readonly finalizedAt: string;
  readonly result: Record<string, unknown>;
  readonly verification: DemoDecisionVerificationSummaryDto;
}

export interface DemoDecisionErrorDto {
  readonly decisionId: string;
  readonly status: 'NO_QUORUM' | 'FAILED';
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly error: { readonly code: string; readonly message: string };
}

export type DemoDecisionStatusDto = DemoDecisionPendingDto | DemoDecisionFinalizedDto | DemoDecisionErrorDto;

export type DemoValidatorPhaseDto = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';

export interface DemoValidatorProgressEntryDto {
  readonly validatorId: string;
  readonly phase: DemoValidatorPhaseDto;
  readonly updatedAt: string;
  readonly outputHash?: string;
}

export interface DemoValidatorProgressDto {
  readonly decisionId: string;
  readonly validators: readonly DemoValidatorProgressEntryDto[];
}

/** `receipt` is undefined until the decision is FINALIZED -- not an error,
 * matches @ddn/client-sdk's own RECEIPT_NOT_AVAILABLE-is-not-a-failure
 * framing. The receipt shape itself is @ddn/receipt-sdk's own
 * DecisionReceiptV1, already a safe versioned protocol object with no
 * tenant/internal fields. */
export interface DemoReceiptDto {
  readonly decisionId: string;
  readonly receipt: DecisionReceiptV1 | undefined;
}

/** `anchor` is undefined until the batch is confirmed on-chain -- decoupled
 * from decision finality (ADR-001/ADR-005), never an error. */
export interface DemoAnchorDto {
  readonly decisionId: string;
  readonly anchor: AnchorRecordV1 | undefined;
}

export const DEMO_BFF_ERROR_CODES = [
  'INVALID_DECISION_ID',
  'NOT_FOUND',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'UPSTREAM_ERROR',
  // Reserved for a caller that adds an authentication boundary around the
  // shared BFF helpers. Public reference routes do not emit this code.
  'UNAUTHENTICATED',
  // Reserved for an integrating caller's own request validation.
  'INVALID_REQUEST',
] as const;
export type DemoBffErrorCode = (typeof DEMO_BFF_ERROR_CODES)[number];

export interface DemoBffErrorDto {
  readonly error: { readonly code: DemoBffErrorCode; readonly message: string };
}
