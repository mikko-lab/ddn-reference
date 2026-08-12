// SPDX-License-Identifier: Apache-2.0
// Everything a route handler needs beyond the parsed request itself.
// Built once at boot (see server.ts) from real files/config; tests build
// their own instance with fakes/fixtures instead of hitting the network
// or spawning real validator processes.

import type { AnchorSidecarStore } from '@ddn/anchor-service';
import type { ApiConfig } from './config.js';
import type { DecisionRepository } from './decisions/types.js';
import type { ValidatorProgressStore } from './decisions/validator-progress-store.js';
import type { PolicyRegistry } from './policies/policy-registry.js';
import type { VerificationProfile } from './policies/verification-profile.js';

export interface AppDependencies {
  readonly config: ApiConfig;
  readonly decisionRepository: DecisionRepository;
  readonly policyRegistry: PolicyRegistry;
  readonly verificationProfile: VerificationProfile;
  /** Milestone 6: in-process only, constructed and injected the same way
   * decisionRepository is -- see server.ts and @ddn/anchor-service's own
   * header comment for why this is not a separate process. */
  readonly anchorSidecarStore: AnchorSidecarStore;
  /** Milestone 7: in-memory mirror of real per-validator progress events,
   * for the validator status view -- see validator-progress-store.ts. */
  readonly validatorProgressStore: ValidatorProgressStore;
}
