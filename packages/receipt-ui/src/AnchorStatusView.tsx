// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import type { AnchorRecordV1 } from '@ddn/receipt-sdk';
import { LabeledValue } from './LabeledValue.js';

export interface AnchorStatusViewProps {
  /** undefined means "not yet anchored" -- anchoring is decoupled from
   * decision finality (ADR-001/ADR-005), so this is never itself a
   * failure, only an incomplete/not-yet-available state. */
  readonly anchor: AnchorRecordV1 | undefined;
}

export function AnchorStatusView({ anchor }: AnchorStatusViewProps): JSX.Element {
  if (!anchor) {
    return <p role="status">Not yet anchored on-chain. This does not affect the decision's finality.</p>;
  }
  return (
    <dl style={{ display: 'grid', gap: '0.75em' }}>
      <LabeledValue label="Chain ID" value={String(anchor.chain.chainId)} />
      <LabeledValue label="Contract address" value={anchor.chain.contractAddress} />
      <LabeledValue label="Transaction hash" value={anchor.confirmation.txHash} />
      <LabeledValue label="Block number" value={String(anchor.confirmation.blockNumber)} />
      <LabeledValue label="Merkle root" value={anchor.merkleRoot} />
      <LabeledValue label="Batch ID" value={anchor.batchId} />
    </dl>
  );
}
