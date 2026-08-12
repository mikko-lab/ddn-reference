// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import type { JSX } from 'react';
import { createDecisionBffClient } from '@ddn/demo-web-kit';
import { DecisionDetailClient } from '@ddn/demo-web-kit/client';

const bffClient = createDecisionBffClient('/api/demo/decisions');

export default function DecisionDetailPage(): JSX.Element {
  const params = useParams<{ decisionId: string }>();
  const decisionId = params.decisionId;

  return (
    <main>
      <h1>Decision detail</h1>
      <DecisionDetailClient decisionId={decisionId} bffClient={bffClient} validatorsHref={`/decisions/${decisionId}/validators`} />
    </main>
  );
}
