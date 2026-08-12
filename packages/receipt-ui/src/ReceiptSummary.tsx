// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import type { DecisionReceiptV1 } from '@ddn/receipt-sdk';
import { LabeledValue } from './LabeledValue.js';

export interface ReceiptSummaryProps {
  readonly receipt: DecisionReceiptV1;
}

/** The core identifying fields of a DecisionReceiptV1 -- receiptId, policy
 * identity, and the input/output hashes -- the core fields specified in
 * docs/decision-receipt-v1.md for a verifier. */
export function ReceiptSummary({ receipt }: ReceiptSummaryProps): JSX.Element {
  return (
    <dl style={{ display: 'grid', gap: '0.75em' }}>
      <LabeledValue label="Receipt ID" value={receipt.receiptId} />
      <LabeledValue label="Policy" value={`${receipt.request.policyId} @ ${receipt.request.policyVersion}`} />
      <LabeledValue label="Policy hash" value={receipt.request.policyHash} />
      <LabeledValue label="Input hash" value={receipt.request.inputHash} />
      <LabeledValue label="Output hash" value={receipt.consensus.outputHash} />
      <LabeledValue label="Status" value={receipt.consensus.status} />
    </dl>
  );
}
