// SPDX-License-Identifier: Apache-2.0
// Milestone 7: a live, read-only mirror of real per-validator subprocess
// lifecycle events (see @ddn/coordinator's onValidatorProgress), for the
// validator status view. Carries only validatorId, phase, timestamp, and
// (once available) the validated outputHash -- never raw stdout/stderr,
// error objects, file paths, or key material; see docs/public-demo-boundary.md.
//
// In-memory only -- same process, same lifetime, same non-durability
// profile as every other Milestone 5/6 in-memory store in this app. Not a
// security- or correctness-critical state machine (nothing downstream
// depends on its own internal consistency the way DecisionRepository's or
// AnchorSidecarStore's do): it only ever mirrors events a single,
// deterministic call path in decision-runner.ts already produced in the
// right order. The one thing worth failing loudly on is a genuinely
// unknown decisionId, since that can only mean this store and
// process-decision.ts's own call sequence have drifted apart.

import type { Sha256Digest } from '@ddn/crypto';
import type { ValidatorProgressPhase } from '@ddn/coordinator';

export type { ValidatorProgressPhase } from '@ddn/coordinator';

export interface ValidatorProgressEntry {
  readonly validatorId: Sha256Digest;
  readonly phase: 'PENDING' | ValidatorProgressPhase;
  readonly updatedAt: string;
  readonly outputHash?: Sha256Digest;
}

export class ValidatorProgressStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidatorProgressStoreError';
  }
}

export class ValidatorProgressStore {
  private readonly byDecisionId = new Map<string, Map<Sha256Digest, ValidatorProgressEntry>>();

  /** Called once, synchronously, right before the real validator instances
   * are started -- registers every validatorId this decision will use as
   * PENDING, so a poll landing in that brief window sees an honest "not
   * started yet" rather than nothing. */
  registerPending(decisionId: string, validatorIds: readonly Sha256Digest[], at: string): void {
    const entries = new Map<Sha256Digest, ValidatorProgressEntry>();
    for (const validatorId of validatorIds) entries.set(validatorId, { validatorId, phase: 'PENDING', updatedAt: at });
    this.byDecisionId.set(decisionId, entries);
  }

  update(decisionId: string, validatorId: Sha256Digest, phase: ValidatorProgressPhase, at: string, outputHash?: Sha256Digest): void {
    const entries = this.byDecisionId.get(decisionId);
    if (!entries) {
      throw new ValidatorProgressStoreError(
        `no validator progress entries registered for decisionId ${decisionId} -- registerPending must run before update`
      );
    }
    entries.set(validatorId, outputHash !== undefined ? { validatorId, phase, updatedAt: at, outputHash } : { validatorId, phase, updatedAt: at });
  }

  /** Returns undefined only if this decisionId has never been registered
   * at all (e.g. still PENDING, not yet picked up by processDecision) --
   * callers should treat that as "no validators yet", not an error. */
  get(decisionId: string): readonly ValidatorProgressEntry[] | undefined {
    const entries = this.byDecisionId.get(decisionId);
    return entries ? [...entries.values()] : undefined;
  }
}
