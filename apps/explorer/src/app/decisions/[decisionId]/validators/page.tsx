// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import type { JSX } from 'react';
import Link from 'next/link';
import { isTerminalDecisionStatus, isTerminalValidatorPhase } from '@ddn/demo-web-kit';
import { ValidatorStatusView, usePolling } from '@ddn/demo-web-kit/client';
import { fetchDemoDecisionStatus, fetchDemoValidatorProgress } from '../../../../lib/demo-bff-client';

const POLL_INTERVAL_MS = 500;

export default function ValidatorStatusPage(): JSX.Element {
  const params = useParams<{ decisionId: string }>();
  const decisionId = params.decisionId;

  const statusState = usePolling(() => fetchDemoDecisionStatus(decisionId), {
    intervalMs: POLL_INTERVAL_MS,
    enabled: true,
    isTerminal: (data) => isTerminalDecisionStatus(data.status),
  });

  const decisionTerminal = statusState.status === 'loaded' && isTerminalDecisionStatus(statusState.data.status);

  const validatorsState = usePolling(() => fetchDemoValidatorProgress(decisionId), {
    intervalMs: POLL_INTERVAL_MS,
    enabled: !decisionTerminal,
    isTerminal: (data) => data.validators.length > 0 && data.validators.every((v) => isTerminalValidatorPhase(v.phase)),
  });

  const allValidatorsTerminal =
    validatorsState.status === 'loaded' && validatorsState.data.validators.length > 0 && validatorsState.data.validators.every((v) => isTerminalValidatorPhase(v.phase));

  return (
    <main>
      <p>
        <Link href={`/decisions/${decisionId}`}>Back to decision detail</Link>
      </p>
      <h1>Live validator progress</h1>
      <ValidatorStatusView decisionId={decisionId} statusState={statusState} validatorsState={validatorsState} polling={!decisionTerminal && !allValidatorsTerminal} />
    </main>
  );
}
