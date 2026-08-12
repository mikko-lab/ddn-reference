// SPDX-License-Identifier: Apache-2.0
// Orchestrates one decision end to end: builds an ExecutionRequestV1 via
// the real ddn-validator binary (so policyHash/profileHash/manifestHash/
// inputHash are derived from the actual on-disk package, never
// recomputed by hand here), runs @ddn/coordinator's decide() against the
// configured isolated validator instances, and -- before ever reporting
// FINALIZED -- independently self-verifies the resulting receipt with
// @ddn/receipt-sdk. A receipt that fails that self-check is treated as a
// failure, not a success this process merely assembled; see
// docs/api-v1.md's "receipt self-verification gate."

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { decide, type ValidatorInstanceConfig, type ValidatorProgressEvent } from '@ddn/coordinator';
import {
  deriveValidatorId,
  parseExecutionRequestV1,
  verifyDecisionReceipt,
  type CoordinatorFailureV1,
  type DecisionReceiptV1,
  type ExecutionRequestV1,
  type ValidatorSetV1,
} from '@ddn/receipt-sdk';
import type { Sha256Digest } from '@ddn/crypto';
import type { ApiConfig } from '../config.js';
import { ApiError } from '../errors/api-error.js';
import type { PolicyRegistryEntry } from '../policies/policy-registry.js';
import { loadTrustedValidatorSet } from '../policies/validator-set-loader.js';

const execFileAsync = promisify(execFile);

export interface DecisionRunnerInput {
  readonly decisionId: string;
  readonly policyEntry: PolicyRegistryEntry;
  readonly profilePath: string | undefined;
  readonly input: Record<string, unknown>;
}

/** Milestone 7: the two hooks runDecision needs to drive a live validator
 * progress store -- narrower than the full store class, matching the same
 * fake-substitutable-dependency pattern as finalize.ts's
 * AnchorEligibilityMarker. Both optional; existing callers that don't pass
 * this are unaffected. */
export interface ValidatorProgressCallbacks {
  /** Called once, synchronously, before any validator instance starts. */
  readonly onRegistered: (validatorIds: readonly Sha256Digest[]) => void;
  readonly onProgress: (event: ValidatorProgressEvent) => void;
}

export type DecisionRunOutcome =
  | { readonly kind: 'FINALIZED'; readonly receipt: DecisionReceiptV1 }
  | { readonly kind: 'NO_QUORUM'; readonly message: string }
  | { readonly kind: 'FAILED'; readonly message: string };

async function buildExecutionRequest(
  config: ApiConfig,
  tempDir: string,
  run: DecisionRunnerInput
): Promise<{ request: ExecutionRequestV1; requestPath: string }> {
  const inputPath = join(tempDir, 'input.json');
  await writeFile(inputPath, JSON.stringify(run.input));

  const args = ['build-request', '--policy', run.policyEntry.policyPackagePath, '--input', inputPath, '--request-id', run.decisionId];
  if (run.profilePath !== undefined) {
    args.push('--profile', run.profilePath);
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(config.validatorBinaryPath, args));
  } catch {
    throw new ApiError('COORDINATOR_FAILED', 'failed to build the execution request for the configured policy package');
  }

  const requestPath = join(tempDir, 'request.json');
  await writeFile(requestPath, stdout);
  return { request: parseExecutionRequestV1(JSON.parse(stdout)), requestPath };
}

/** The fail-closed gate: never returns FINALIZED for a receipt this
 * process cannot itself re-verify against `validatorSet`, even though
 * @ddn/coordinator's decide() is the one that just assembled it.
 * Extracted as its own pure function (no I/O) so it can be unit tested
 * directly with a receipt/validatorSet pair known to disagree, without
 * needing a real quorum run to produce one. */
export function assembleOutcomeFromReceipt(receipt: DecisionReceiptV1, validatorSet: ValidatorSetV1): DecisionRunOutcome {
  const verification = verifyDecisionReceipt(receipt, validatorSet);
  if (!verification.ok) {
    throw new ApiError('RECEIPT_SELF_VERIFICATION_FAILED', 'the assembled receipt failed local self-verification and was not finalized');
  }
  return { kind: 'FINALIZED', receipt };
}

/** Maps @ddn/receipt-sdk's CoordinatorFailureV1.reason to this module's
 * DecisionRunOutcome. Extracted as its own pure function so the
 * EXECUTION_HASH_COLLISION branch (validators disagreeing on identical
 * input -- distinct from simply not enough of them responding) can be
 * unit tested directly, without needing to actually engineer that
 * disagreement through a real quorum run. */
export function mapCoordinatorFailure(failure: CoordinatorFailureV1): DecisionRunOutcome {
  if (failure.reason === 'NO_QUORUM') {
    return { kind: 'NO_QUORUM', message: 'insufficient matching validator results to reach quorum' };
  }
  return { kind: 'FAILED', message: 'validators produced divergent results for identical inputs (execution hash collision)' };
}

export async function runDecision(
  config: ApiConfig,
  run: DecisionRunnerInput,
  progress?: ValidatorProgressCallbacks
): Promise<DecisionRunOutcome> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ddn-api-decision-'));
  try {
    const { request, requestPath } = await buildExecutionRequest(config, tempDir, run);
    const validatorSet = await loadTrustedValidatorSet(config.validatorSetPath);

    const validatorInstances: ValidatorInstanceConfig[] = await Promise.all(
      config.validatorInstances.map(async (instance) => ({
        privateKeyFilePath: instance.privateKeyFilePath,
        publicKeyHex: (await readFile(instance.publicKeyFilePath, 'utf8')).trim(),
      }))
    );

    progress?.onRegistered(validatorInstances.map((instance) => deriveValidatorId(instance.publicKeyHex)));

    const outcome = await decide({
      validatorBinaryPath: config.validatorBinaryPath,
      policyPackagePath: run.policyEntry.policyPackagePath,
      profilePath: run.profilePath,
      request,
      requestPath,
      validatorSet,
      validatorInstances,
      timeoutMs: config.decisionTimeoutMs,
      onValidatorProgress: progress?.onProgress,
    });

    if (outcome.receipt) {
      return assembleOutcomeFromReceipt(outcome.receipt, validatorSet);
    }

    const failure = outcome.failure;
    if (failure === null) {
      throw new ApiError('COORDINATOR_FAILED', 'coordinator produced neither a receipt nor a failure');
    }
    return mapCoordinatorFailure(failure);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
