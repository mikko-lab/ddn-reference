// SPDX-License-Identifier: Apache-2.0
// Presentation-only mapping from @ddn/receipt-sdk's canonical
// VerificationOutcome (computeVerificationOutcome) to a label/glyph/tone --
// deliberately NOT redefining the outcome type itself, so there is exactly
// one place (receipt-sdk) deciding what VALID/INVALID/INCOMPLETE means.
// See docs/public-demo-boundary.md.

export type { VerificationOutcome } from '@ddn/receipt-sdk';
import type { VerificationOutcome } from '@ddn/receipt-sdk';

export type VerificationOutcomeTone = 'success' | 'error' | 'warning';

export interface VerificationOutcomeDescription {
  readonly label: string;
  /** A short, non-color-dependent glyph shown alongside the label so the
   * outcome is never conveyed by color alone (WCAG 2.2 1.4.1). */
  readonly glyph: string;
  readonly tone: VerificationOutcomeTone;
  readonly description: string;
}

const DESCRIPTIONS: Readonly<Record<VerificationOutcome, VerificationOutcomeDescription>> = {
  VALID: {
    label: 'Valid',
    glyph: '✓',
    tone: 'success',
    description: 'Every check (receipt, quorum, Merkle proof, chain binding, on-chain root) passed against the trusted demo profile.',
  },
  INVALID: {
    label: 'Invalid',
    glyph: '✕',
    tone: 'error',
    description: 'At least one check failed -- the receipt does not match what the trusted validator set and on-chain anchor actually attest to.',
  },
  INCOMPLETE: {
    label: 'Incomplete',
    glyph: '…',
    tone: 'warning',
    description: 'Verification could not be completed -- an RPC/transport failure or a decision that has not yet been anchored, not a tamper finding.',
  },
};

export function describeVerificationOutcome(outcome: VerificationOutcome): VerificationOutcomeDescription {
  return DESCRIPTIONS[outcome];
}
