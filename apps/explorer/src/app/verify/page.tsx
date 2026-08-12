// SPDX-License-Identifier: Apache-2.0
'use client';

import { useState, type ChangeEvent, type JSX } from 'react';
import { computeVerificationOutcome, type AnchorRecordV1, type DecisionReceiptV1, type VerificationOutcomeResult } from '@ddn/receipt-sdk';
import {
  AnchorStatusView,
  QuorumSummary,
  ReceiptSummary,
  ValidatorSignatureList,
  VerificationOutcomeBadge,
} from '@ddn/receipt-ui';
import { createDemoChainReader } from '@ddn/demo-trust-profile/browser';
import { getChainRpcUrl } from '@ddn/demo-web-kit';
import { getTrustedDemoProfile } from '@ddn/demo-web-kit/client';
import { parseVerifyInput } from '../../lib/verify-input';

interface VerifiedState {
  readonly outcome: VerificationOutcomeResult;
  readonly receipt: DecisionReceiptV1;
  readonly anchorRecord: AnchorRecordV1 | undefined;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('could not read file'));
    reader.readAsText(file);
  });
}

export default function VerifyPage(): JSX.Element {
  const [receiptText, setReceiptText] = useState('');
  const [anchorText, setAnchorText] = useState('');
  const [parseError, setParseError] = useState<string | undefined>(undefined);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<VerifiedState | undefined>(undefined);

  async function handleReceiptFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (file) setReceiptText(await readFileAsText(file));
  }

  async function handleAnchorFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (file) setAnchorText(await readFileAsText(file));
  }

  async function handleVerify(): Promise<void> {
    setParseError(undefined);
    setVerified(undefined);

    const parsed = parseVerifyInput(receiptText, anchorText);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }

    setVerifying(true);
    try {
      const profile = getTrustedDemoProfile();
      const chainReader = parsed.anchorRecord ? createDemoChainReader(getChainRpcUrl(), profile) : undefined;
      const outcome = await computeVerificationOutcome(parsed.receipt, profile.validatorSet, parsed.anchorRecord, chainReader);
      setVerified({ outcome, receipt: parsed.receipt, anchorRecord: parsed.anchorRecord });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <main>
      <h1>Verify a receipt</h1>
      <p>
        Paste or upload a <code>DecisionReceiptV1</code>. An on-chain anchor record is optional -- without one, verification
        reports <strong>INCOMPLETE</strong> rather than a failure.
      </p>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <div>
          <label htmlFor="receipt-input">
            <strong>Receipt JSON</strong> (required)
          </label>
          <br />
          <input
            type="file"
            accept="application/json"
            onChange={(e) => void handleReceiptFile(e)}
            aria-label="Upload receipt JSON file"
            aria-describedby="receipt-input"
          />
          <textarea
            id="receipt-input"
            value={receiptText}
            onChange={(e) => setReceiptText(e.target.value)}
            rows={10}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', marginTop: '0.5rem' }}
            placeholder="Paste a DecisionReceiptV1 JSON object here"
          />
        </div>

        <div>
          <label htmlFor="anchor-input">
            <strong>Anchor record JSON</strong> (optional)
          </label>
          <br />
          <input
            type="file"
            accept="application/json"
            onChange={(e) => void handleAnchorFile(e)}
            aria-label="Upload anchor record JSON file"
            aria-describedby="anchor-input"
          />
          <textarea
            id="anchor-input"
            value={anchorText}
            onChange={(e) => setAnchorText(e.target.value)}
            rows={6}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', marginTop: '0.5rem' }}
            placeholder="Paste an AnchorRecordV1 JSON object here, or leave blank"
          />
        </div>

        <div>
          <button type="button" onClick={() => void handleVerify()} disabled={verifying}>
            {verifying ? 'Verifying...' : 'Verify'}
          </button>
        </div>

        {parseError && (
          <p role="alert" style={{ color: '#7a1010' }}>
            {parseError}
          </p>
        )}

        {verified && (
          <section style={{ display: 'grid', gap: '1.5rem', borderTop: '1px solid #ccc', paddingTop: '1.5rem' }}>
            <div>
              <VerificationOutcomeBadge outcome={verified.outcome.outcome} />
              <p>{verified.outcome.detail}</p>
            </div>

            <div>
              <h2>Receipt</h2>
              <ReceiptSummary receipt={verified.receipt} />
            </div>
            <div>
              <h2>Quorum</h2>
              <QuorumSummary quorum={verified.receipt.quorum} />
            </div>
            <div>
              <h2>Validator signatures</h2>
              <ValidatorSignatureList signedResults={verified.receipt.signedResults} />
            </div>

            <div>
              <h2>On-chain anchor</h2>
              <AnchorStatusView anchor={verified.anchorRecord} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
