// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';

export type ValidatorProgressPhase = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';

export interface ValidatorProgressEntry {
  readonly validatorId: string;
  readonly phase: ValidatorProgressPhase;
  readonly updatedAt: string;
  readonly outputHash?: string;
}

export interface ValidatorProgressListProps {
  readonly validators: readonly ValidatorProgressEntry[];
}

/** Milestone 7: real per-validator subprocess progress (never a
 * simulated/timed animation) -- one row per validator, its current phase,
 * and outputHash only once SUCCEEDED. An empty list means the decision
 * hasn't started running validators yet (still PENDING), not an error. */
export function ValidatorProgressList({ validators }: ValidatorProgressListProps): JSX.Element {
  if (validators.length === 0) {
    return <p role="status">No validators have started yet.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Validator</th>
          <th scope="col">Phase</th>
          <th scope="col">Updated</th>
          <th scope="col">Output hash</th>
        </tr>
      </thead>
      <tbody>
        {validators.map((v) => (
          <tr key={v.validatorId}>
            <td style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{v.validatorId}</td>
            <td>{v.phase}</td>
            <td>{v.updatedAt}</td>
            <td style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{v.outputHash ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
