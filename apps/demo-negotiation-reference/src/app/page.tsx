// SPDX-License-Identifier: Apache-2.0
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { DEMO_REFERENCE_FLOOR_PRICE_CENTS, DEMO_REFERENCE_LIST_PRICE_CENTS } from '../lib/offer-input';
import { getNextOfferNumber, getOrCreateSessionId, recordOfferSubmitted } from '../lib/offer-session';

function centsToEuros(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OfferPage(): JSX.Element {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [offerNumber, setOfferNumber] = useState(1);
  const [offerAmount, setOfferAmount] = useState('');
  const [conditionReportAcknowledged, setConditionReportAcknowledged] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSessionId(getOrCreateSessionId(window.sessionStorage));
    setOfferNumber(getNextOfferNumber(window.sessionStorage));
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    if (!sessionId) return;

    const euros = Number.parseFloat(offerAmount);
    if (!Number.isFinite(euros) || euros < 0) {
      setError('Enter a valid offer amount.');
      return;
    }
    const customerOfferCents = Math.round(euros * 100);

    setSubmitting(true);
    try {
      const res = await fetch('/api/offer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, customerOfferCents, offerNumber, conditionReportAcknowledged }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const message = (body as { error?: { message?: string } }).error?.message ?? 'submission failed';
        setError(message);
        return;
      }
      recordOfferSubmitted(window.sessionStorage, offerNumber);
      const decisionId = (body as { decisionId: string }).decisionId;
      router.push(`/offer/${decisionId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Negotiation Reference demo: make an offer</h1>
      <p role="note">
        A self-contained, synthetic demo -- not data from any production sales system. See{' '}
        <code>policies/negotiation-v1</code>.
      </p>
      <dl>
        <dt>Vehicle list price</dt>
        <dd>&euro;{centsToEuros(DEMO_REFERENCE_LIST_PRICE_CENTS)}</dd>
      </dl>
      <p style={{ fontSize: '0.85em', opacity: 0.75 }}>
        (The floor price -- &euro;{centsToEuros(DEMO_REFERENCE_FLOOR_PRICE_CENTS)} -- is not shown to the customer in a real flow; shown here only
        for this technical demo's transparency.)
      </p>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label htmlFor="offer-amount">Your offer (EUR)</label>
        <br />
        <input id="offer-amount" type="number" step="0.01" min="0" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} required />
        <br />
        <label>
          <input type="checkbox" checked={conditionReportAcknowledged} onChange={(e) => setConditionReportAcknowledged(e.target.checked)} />
          I acknowledge the condition report
        </label>
        <br />
        <p>
          Offer #{offerNumber} for session <code>{sessionId ?? '...'}</code>
        </p>
        <button type="submit" disabled={submitting || !sessionId}>
          {submitting ? 'Submitting...' : 'Submit offer'}
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: '#7a1010' }}>
          {error}
        </p>
      )}
    </main>
  );
}
