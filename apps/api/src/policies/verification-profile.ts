// SPDX-License-Identifier: Apache-2.0
// Loads the single execution profile this deployment is configured with
// (DDN_EXECUTION_PROFILE_PATH, e.g. packages/config/profiles/ddn-wasm-v1.json)
// just far enough to read its own `profileId` -- the field the file
// already carries for its own purposes (see docs/execution-profile-v1.md).
// A request's verificationProfileId must match this deployment's single
// configured profile; there is no per-request choice among multiple
// profiles in this milestone. The full profile content is never
// re-validated here -- that stays ddn-validator's job when it loads the
// same file for execution.

import { readFileSync } from 'node:fs';
import { ApiError } from '../errors/api-error.js';

export interface VerificationProfile {
  readonly profileId: string;
  readonly profilePath: string;
}

export class VerificationProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationProfileError';
  }
}

export function loadVerificationProfile(profilePath: string): VerificationProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch (error) {
    throw new VerificationProfileError(`failed to read/parse execution profile at ${profilePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const profileId = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).profileId : undefined;
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new VerificationProfileError(`${profilePath}: expected a non-empty string "profileId" field`);
  }
  return { profileId, profilePath };
}

export function requireMatchingVerificationProfile(profile: VerificationProfile, requestedId: string): void {
  if (requestedId !== profile.profileId) {
    throw new ApiError('UNKNOWN_VERIFICATION_PROFILE', `unknown verification profile: ${requestedId}`);
  }
}
