// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import type { DecisionReceiptQuorumV1 } from '@ddn/receipt-sdk';

export interface QuorumSummaryProps {
  readonly quorum: DecisionReceiptQuorumV1;
}

/** threshold-of-totalValidators agreement summary plus which validator ids
 * actually agreed -- the quorum evidence specified in
 * docs/decision-receipt-v1.md. */
export function QuorumSummary({ quorum }: QuorumSummaryProps): JSX.Element {
  return (
    <div>
      <p>
        <strong>
          {quorum.threshold} of {quorum.totalValidators}
        </strong>{' '}
        validators required to agree.{' '}
        <strong>{quorum.agreeingValidatorIds.length}</strong> agreed.
      </p>
      <ul>
        {quorum.agreeingValidatorIds.map((validatorId) => (
          <li key={validatorId} style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
            {validatorId}
          </li>
        ))}
      </ul>
    </div>
  );
}
