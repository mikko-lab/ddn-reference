// SPDX-License-Identifier: Apache-2.0
// Orchestrates N isolated `ddn-validator execute` instances for one
// ExecutionRequestV1, then hands their (schema-checked) outputs to
// @ddn/receipt-sdk for quorum selection. This module makes the decision
// about *which validators to run*; it never decides the policy outcome or
// re-implements anything @ddn/receipt-sdk already does -- see
// docs/decision-receipt-v1.md's "oikea vastuunjako" note.

import {
  buildCoordinatorFailure,
  buildDecisionReceipt,
  deriveValidatorId,
  parseSignedValidatorResultV1,
  selectQuorum,
  type CoordinatorFailureV1,
  type DecisionReceiptV1,
  type ExecutionRequestV1,
  type SignedValidatorResultV1,
  type ValidatorSetV1,
} from '@ddn/receipt-sdk';
import type { Sha256Digest } from '@ddn/crypto';
import { runIsolatedValidator } from './isolated-validator.js';

// Milestone 7: real per-validator lifecycle events for a live status view --
// never a timer, never a fabricated "in progress" state. Deliberately
// carries nothing beyond validatorId/phase/timestamp/outputHash: no raw
// stdout/stderr, no error objects, no file paths, no key material. See
// docs/public-demo-boundary.md.
export type ValidatorProgressPhase = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';

export interface ValidatorProgressEvent {
  readonly validatorId: Sha256Digest;
  readonly phase: ValidatorProgressPhase;
  readonly at: string;
  /** Only ever present on SUCCEEDED, and only once the signed result has
   * actually been parsed and its shape validated -- never a raw/unverified
   * value. */
  readonly outputHash?: Sha256Digest;
}

export type ValidatorProgressCallback = (event: ValidatorProgressEvent) => void;

export interface ValidatorInstanceConfig {
  readonly privateKeyFilePath: string;
  /** The instance's own public key, read once by the caller from its
   * `.pub` file -- used only to label diagnostics; validatorId is always
   * re-derived from what the process itself signs with, never assumed
   * from this value. */
  readonly publicKeyHex: string;
}

export interface DecideConfig {
  readonly validatorBinaryPath: string;
  readonly policyPackagePath: string;
  readonly profilePath: string | undefined;
  readonly request: ExecutionRequestV1;
  readonly requestPath: string;
  readonly validatorSet: ValidatorSetV1;
  readonly validatorInstances: readonly ValidatorInstanceConfig[];
  readonly timeoutMs: number;
  /** Optional: fires once per instance when it starts, and again once it
   * settles. Never required -- existing callers that don't care about
   * live progress pass nothing and behavior is unchanged. */
  readonly onValidatorProgress?: ValidatorProgressCallback | undefined;
}

export type ValidatorInstanceDiagnosticOutcome = 'SUCCESS' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'PROCESS_ERROR';

export interface ValidatorInstanceDiagnostic {
  readonly publicKey: string;
  readonly outcome: ValidatorInstanceDiagnosticOutcome;
  readonly detail: string | undefined;
}

export interface DecideOutcome {
  readonly receipt: DecisionReceiptV1 | null;
  readonly failure: CoordinatorFailureV1 | null;
  readonly perValidatorDiagnostics: readonly ValidatorInstanceDiagnostic[];
}

export async function decide(config: DecideConfig): Promise<DecideOutcome> {
  const diagnostics: ValidatorInstanceDiagnostic[] = [];
  const collected: SignedValidatorResultV1[] = [];

  const runs = await Promise.all(
    config.validatorInstances.map(async (instance) => {
      const validatorId = deriveValidatorId(instance.publicKeyHex);
      config.onValidatorProgress?.({ validatorId, phase: 'RUNNING', at: new Date().toISOString() });
      const outcome = await runIsolatedValidator({
        validatorBinaryPath: config.validatorBinaryPath,
        policyPackagePath: config.policyPackagePath,
        profilePath: config.profilePath,
        requestPath: config.requestPath,
        privateKeyFilePath: instance.privateKeyFilePath,
        timeoutMs: config.timeoutMs,
      });
      return { instance, validatorId, outcome };
    }),
  );

  for (const { instance, validatorId, outcome } of runs) {
    if (outcome.kind === 'SUCCESS') {
      try {
        const signed = parseSignedValidatorResultV1(JSON.parse(outcome.stdout));
        collected.push(signed);
        diagnostics.push({ publicKey: instance.publicKeyHex, outcome: 'SUCCESS', detail: undefined });
        config.onValidatorProgress?.({
          validatorId,
          phase: 'SUCCEEDED',
          at: new Date().toISOString(),
          outputHash: signed.result.outputHash,
        });
      } catch (error) {
        diagnostics.push({
          publicKey: instance.publicKeyHex,
          outcome: 'INVALID_OUTPUT',
          detail: error instanceof Error ? error.message : String(error),
        });
        config.onValidatorProgress?.({ validatorId, phase: 'FAILED', at: new Date().toISOString() });
      }
    } else if (outcome.kind === 'TIMEOUT') {
      diagnostics.push({ publicKey: instance.publicKeyHex, outcome: 'TIMEOUT', detail: undefined });
      config.onValidatorProgress?.({ validatorId, phase: 'TIMED_OUT', at: new Date().toISOString() });
    } else {
      diagnostics.push({
        publicKey: instance.publicKeyHex,
        outcome: 'PROCESS_ERROR',
        detail: outcome.stderr || `exit code ${String(outcome.exitCode)}`,
      });
      config.onValidatorProgress?.({ validatorId, phase: 'FAILED', at: new Date().toISOString() });
    }
  }

  const quorum = selectQuorum(collected, config.request, config.validatorSet);
  if (quorum.outcome === 'QUORUM_REACHED') {
    return {
      receipt: buildDecisionReceipt(config.request, config.validatorSet, quorum),
      failure: null,
      perValidatorDiagnostics: diagnostics,
    };
  }
  return {
    receipt: null,
    failure: buildCoordinatorFailure(config.request, quorum),
    perValidatorDiagnostics: diagnostics,
  };
}
