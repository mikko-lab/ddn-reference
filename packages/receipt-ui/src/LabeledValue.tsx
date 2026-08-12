// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';

export interface LabeledValueProps {
  readonly label: string;
  readonly value: string;
}

/** Renders one labeled value in full -- never truncated. A verifier exists
 * specifically so a person can compare hashes and identifiers; hiding part
 * of the value behind an ellipsis would defeat that. */
export function LabeledValue({ label, value }: LabeledValueProps): JSX.Element {
  return (
    <div>
      <dt style={{ fontSize: '0.85em', color: 'inherit', opacity: 0.75 }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{value}</dd>
    </div>
  );
}
