// SPDX-License-Identifier: Apache-2.0
// Pure integrity check, split out from load-profile.ts (which reads the
// committed file from disk via node:fs) so it can be imported from
// browser.ts without pulling any Node-only module into a browser bundle.

import { computeValidatorSetId } from '@ddn/receipt-sdk';
import { TrustedDemoProfileError, type TrustedDemoProfileV1 } from './trusted-demo-profile.js';

/** Re-derives validatorSetId from the profile's own content, throwing if it
 * doesn't match -- catches a hand-edited or corrupted profile, not just a
 * malformed one. */
export function assertProfileIntegrity(profile: TrustedDemoProfileV1): void {
  const recomputed = computeValidatorSetId(profile.validatorSet);
  if (recomputed !== profile.validatorSet.validatorSetId) {
    throw new TrustedDemoProfileError(
      'INVALID_FIELD',
      `TrustedDemoProfileV1.validatorSet.validatorSetId (${profile.validatorSet.validatorSetId}) does not match its own content (recomputed: ${recomputed}) -- refusing a tampered or corrupted profile`
    );
  }
}
