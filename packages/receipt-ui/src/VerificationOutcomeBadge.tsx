// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties, JSX } from 'react';
import { describeVerificationOutcome, type VerificationOutcome } from './verification-outcome.js';

export interface VerificationOutcomeBadgeProps {
  readonly outcome: VerificationOutcome;
}

const TONE_STYLE: Record<string, CSSProperties> = {
  success: { color: '#0a5c2a', background: '#e3f6e8', borderColor: '#0a5c2a' },
  error: { color: '#7a1010', background: '#fbe6e6', borderColor: '#7a1010' },
  warning: { color: '#7a4b00', background: '#fff3e0', borderColor: '#7a4b00' },
};

/** Announces the outcome to assistive tech via role="status"/aria-live,
 * and never conveys it by color alone -- label text plus a glyph prefix
 * both change with the outcome. */
export function VerificationOutcomeBadge({ outcome }: VerificationOutcomeBadgeProps): JSX.Element {
  const description = describeVerificationOutcome(outcome);
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5em',
        padding: '0.25em 0.75em',
        borderRadius: '999px',
        border: '1px solid',
        fontWeight: 600,
        ...TONE_STYLE[description.tone],
      }}
      title={description.description}
    >
      <span aria-hidden="true">{description.glyph}</span>
      {description.label}
    </span>
  );
}
