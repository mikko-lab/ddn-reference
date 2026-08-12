// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import type { VerificationOutcomeResult } from '@ddn/receipt-sdk';
import { AnchorStatusView, QuorumSummary, ReceiptSummary, ValidatorProgressList, VerificationOutcomeBadge } from '@ddn/receipt-ui';
import type { FetchState } from './fetch-state.js';
import type { DemoAnchorDto, DemoDecisionStatusDto, DemoReceiptDto, DemoValidatorProgressDto } from './demo-decision-dto.js';

export interface DecisionDetailViewProps {
  readonly decisionId: string;
  readonly statusState: FetchState<DemoDecisionStatusDto>;
  readonly validatorsState: FetchState<DemoValidatorProgressDto>;
  readonly receiptState: FetchState<DemoReceiptDto>;
  readonly anchorState: FetchState<DemoAnchorDto>;
  /** Computed by the caller (client-side, via @ddn/receipt-sdk's
   * computeVerificationOutcome against the fetched receipt/anchor) --
   * this component never runs verification itself, only renders the
   * result, matching @ddn/receipt-ui's own "no data fetching" scope. */
  readonly localVerification: VerificationOutcomeResult | undefined;
}

function StatusMessage({ state, whatFor }: { readonly state: FetchState<unknown>; readonly whatFor: string }): JSX.Element | null {
  if (state.status === 'loading') return <p role="status">Loading {whatFor}...</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" style={{ color: '#7a1010' }}>
        Could not load {whatFor}: {state.message}
      </p>
    );
  }
  return null;
}

/** Renders a decision's real, currently-known state -- never a simulated
 * or timed animation. Four clearly separated sections, matching task
 * #54's explicit requirement: decision status; validator results and
 * quorum; local receipt verification; on-chain anchor status. See
 * docs/public-demo-boundary.md. */
export function DecisionDetailView({
  decisionId,
  statusState,
  validatorsState,
  receiptState,
  anchorState,
  localVerification,
}: DecisionDetailViewProps): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: '2rem' }}>
      <section>
        <h2>Decision status</h2>
        <p>
          Decision <code>{decisionId}</code>
        </p>
        <StatusMessage state={statusState} whatFor="decision status" />
        {statusState.status === 'loaded' && (
          <dl>
            <dt>Status</dt>
            <dd>{statusState.data.status}</dd>
            {statusState.data.status === 'FINALIZED' && (
              <>
                <dt>Finalized at</dt>
                <dd>{statusState.data.finalizedAt}</dd>
                <dt>Result</dt>
                <dd>
                  <pre>{JSON.stringify(statusState.data.result, null, 2)}</pre>
                </dd>
              </>
            )}
            {(statusState.data.status === 'NO_QUORUM' || statusState.data.status === 'FAILED') && (
              <>
                <dt>Reason</dt>
                <dd>{statusState.data.error.message}</dd>
              </>
            )}
          </dl>
        )}
      </section>

      <section>
        <h2>Validator results &amp; quorum</h2>
        <StatusMessage state={validatorsState} whatFor="validator progress" />
        {validatorsState.status === 'loaded' && <ValidatorProgressList validators={validatorsState.data.validators} />}
        {receiptState.status === 'loaded' && receiptState.data.receipt !== undefined ? (
          // The receipt's own quorum carries the actual agreeingValidatorIds
          // list -- use it once available instead of a synthesized one.
          <QuorumSummary quorum={receiptState.data.receipt.quorum} />
        ) : (
          statusState.status === 'loaded' &&
          statusState.data.status === 'FINALIZED' && (
            <p>
              {statusState.data.verification.matchingValidators} of {statusState.data.verification.requiredQuorum} required validators agreed.
            </p>
          )
        )}
      </section>

      <section>
        <h2>Local receipt verification</h2>
        <StatusMessage state={receiptState} whatFor="receipt" />
        {receiptState.status === 'loaded' && receiptState.data.receipt === undefined && <p role="status">Not finalized yet -- no receipt to verify.</p>}
        {receiptState.status === 'loaded' && receiptState.data.receipt !== undefined && (
          <>
            {localVerification && <VerificationOutcomeBadge outcome={localVerification.outcome} />}
            <ReceiptSummary receipt={receiptState.data.receipt} />
          </>
        )}
      </section>

      <section>
        <h2>On-chain anchor</h2>
        <StatusMessage state={anchorState} whatFor="anchor status" />
        {anchorState.status === 'loaded' && <AnchorStatusView anchor={anchorState.data.anchor} />}
      </section>
    </div>
  );
}
