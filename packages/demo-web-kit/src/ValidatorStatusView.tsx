// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import { ValidatorProgressList } from '@ddn/receipt-ui';
import type { FetchState } from './fetch-state.js';
import type { DemoDecisionStatusDto, DemoValidatorProgressDto } from './demo-decision-dto.js';

export interface ValidatorStatusViewProps {
  readonly decisionId: string;
  readonly statusState: FetchState<DemoDecisionStatusDto>;
  readonly validatorsState: FetchState<DemoValidatorProgressDto>;
  readonly polling: boolean;
}

/** A dedicated, live view of one decision's real per-validator subprocess
 * progress -- every phase shown here comes from an actual poll response,
 * never a simulated/timed animation. Polling stops once every validator
 * reaches a terminal phase or the decision itself reaches a terminal
 * status (see isTerminalValidatorPhase/isTerminalDecisionStatus and the
 * page component that drives this view). See docs/public-demo-boundary.md. */
export function ValidatorStatusView({ decisionId, statusState, validatorsState, polling }: ValidatorStatusViewProps): JSX.Element {
  return (
    <div>
      <p>
        Decision <code>{decisionId}</code>
        {statusState.status === 'loaded' && <> -- {statusState.data.status}</>}
      </p>
      <p role="status">{polling ? 'Watching for live validator updates...' : 'All validators have reached a final state.'}</p>
      {validatorsState.status === 'loading' && <p role="status">Loading validator progress...</p>}
      {validatorsState.status === 'error' && (
        <p role="alert" style={{ color: '#7a1010' }}>
          Could not load validator progress: {validatorsState.message}
        </p>
      )}
      {validatorsState.status === 'loaded' && <ValidatorProgressList validators={validatorsState.data.validators} />}
    </div>
  );
}
