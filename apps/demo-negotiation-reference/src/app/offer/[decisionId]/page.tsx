// SPDX-License-Identifier: Apache-2.0
'use client';

import { useParams } from 'next/navigation';
import type { JSX } from 'react';
import { createDecisionBffClient } from '@ddn/demo-web-kit';
import { DecisionDetailClient } from '@ddn/demo-web-kit/client';

const bffClient = createDecisionBffClient('/api/reference/decisions');

export default function OfferResultPage(): JSX.Element {
  const params = useParams<{ decisionId: string }>();
  const decisionId = params.decisionId;

  return (
    <main>
      <h1>Your offer</h1>
      <p role="note">
        Live, real state from the Deterministic Decision Network -- every step below reflects an actual response, never a simulated animation.
      </p>
      <DecisionDetailClient decisionId={decisionId} bffClient={bffClient} />
      <p>
        <a href="/">Submit another offer</a>
      </p>
    </main>
  );
}
