// SPDX-License-Identifier: Apache-2.0
// Runs one decision to completion in the background: PENDING -> RUNNING
// -> a terminal state. Invoked fire-and-forget from the POST /v1/decisions
// handler (which has already responded with the PENDING record) -- a
// client learns the outcome by polling GET /v1/decisions/{decisionId}.
// Every exit path, including an unexpected exception anywhere in this
// function (a thrown ApiError('RECEIPT_SELF_VERIFICATION_FAILED', ...)
// from runDecision included), still resolves the decision to a terminal
// state; nothing is ever left stuck in RUNNING.

import type { AppDependencies } from '../dependencies.js';
import { ApiError } from '../errors/api-error.js';
import { requireActivePolicy } from '../policies/policy-registry.js';
import { runDecision, type ValidatorProgressCallbacks } from './decision-runner.js';
import { finalizeDecisionAndMarkEligible } from './finalize.js';
import { extractResultObject } from './response-mapping.js';
import type { ErrorDecisionRecord, FinalizedDecisionRecord, PendingDecisionRecord, RunningDecisionRecord } from './types.js';

export async function processDecision(deps: AppDependencies, pending: PendingDecisionRecord): Promise<void> {
  try {
    const runningAt = new Date().toISOString();
    const running: RunningDecisionRecord = { ...pending, status: 'RUNNING', updatedAt: runningAt };
    await deps.decisionRepository.transition(pending.decisionId, 'PENDING', running);

    const policyEntry = requireActivePolicy(deps.policyRegistry, pending.policy);
    const progress: ValidatorProgressCallbacks = {
      onRegistered: (validatorIds) => deps.validatorProgressStore.registerPending(pending.decisionId, validatorIds, new Date().toISOString()),
      onProgress: (event) => deps.validatorProgressStore.update(pending.decisionId, event.validatorId, event.phase, event.at, event.outputHash),
    };
    const outcome = await runDecision(
      deps.config,
      {
        decisionId: pending.decisionId,
        policyEntry,
        profilePath: deps.verificationProfile.profilePath,
        input: pending.input,
      },
      progress
    );

    if (outcome.kind === 'FINALIZED') {
      const firstResult = outcome.receipt.signedResults[0];
      if (firstResult === undefined) {
        throw new Error('receipt.signedResults was empty despite a FINALIZED outcome');
      }
      const finalizedAt = new Date().toISOString();
      const finalized: FinalizedDecisionRecord = {
        ...running,
        status: 'FINALIZED',
        result: extractResultObject(firstResult.result.output),
        receipt: outcome.receipt,
        finalizedAt,
        updatedAt: finalizedAt,
      };
      // Anchor-eligibility marking and the RUNNING -> FINALIZED transition
      // happen as one synchronous local finalization boundary -- see
      // finalize.ts. A forced failure there (e.g. the sidecar store
      // throwing) propagates to this function's own catch block below,
      // via failDecision, exactly like any other unexpected exception --
      // never leaving this decision FINALIZED without also being ELIGIBLE.
      await finalizeDecisionAndMarkEligible(deps.decisionRepository, deps.anchorSidecarStore, pending.decisionId, finalized);
      return;
    }

    const errored: ErrorDecisionRecord = {
      ...running,
      status: outcome.kind,
      error: { code: outcome.kind, message: outcome.message },
      updatedAt: new Date().toISOString(),
    };
    await deps.decisionRepository.transition(pending.decisionId, 'RUNNING', errored);
  } catch (error) {
    await failDecision(deps, pending, error);
  }
}

const GENERIC_FAILURE_MESSAGE = 'an unexpected internal error occurred while processing this decision';

async function failDecision(deps: AppDependencies, pending: PendingDecisionRecord, error: unknown): Promise<void> {
  // Only an ApiError's message is safe to return to the client -- it is
  // always a deliberately hand-written string (see api-error.ts's call
  // sites), never a raw exception message. Anything else reaching here
  // (e.g. a plain Node fs error from a missing validator-set or
  // public-key file, which embeds the file path in error.message) is
  // logged server-side and replaced with a generic message -- otherwise
  // this would leak exactly the file paths docs/api-security-model.md
  // says a response must never include.
  const isApiError = error instanceof ApiError;
  const code = isApiError ? error.code : 'INTERNAL_ERROR';
  const message = isApiError ? error.message : GENERIC_FAILURE_MESSAGE;
  if (!isApiError) {
    console.error(`decision ${pending.decisionId} failed with an unexpected error:`, error);
  }
  const errored: ErrorDecisionRecord = {
    ...pending,
    status: 'FAILED',
    error: { code, message },
    updatedAt: new Date().toISOString(),
  };
  try {
    await deps.decisionRepository.transition(pending.decisionId, 'RUNNING', errored);
  } catch (transitionError) {
    // Only reachable if the PENDING -> RUNNING transition at the top of
    // processDecision never happened -- there is no legal transition out
    // of PENDING directly to FAILED (see ALLOWED_DECISION_TRANSITIONS), so
    // this is logged loudly rather than silently violating the state
    // machine or leaving the decision stuck without any record of why.
    console.error(`decision ${pending.decisionId} failed (${message}) but could not be transitioned to FAILED:`, transitionError);
  }
}
