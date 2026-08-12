// SPDX-License-Identifier: Apache-2.0
'use client';

import { useEffect, useState, type JSX } from 'react';
import { computeVerificationOutcome, type VerificationOutcomeResult } from '@ddn/receipt-sdk';
import { createDemoChainReader } from '@ddn/demo-trust-profile/browser';
import type { DecisionBffClient } from './decision-bff-client.js';
import { getChainRpcUrl } from './chain-rpc-url.js';
import { isTerminalDecisionStatus, isTerminalValidatorPhase } from './demo-decision-mapper.js';
import { errored, idle, loaded, loading, type FetchState } from './fetch-state.js';
import { getTrustedDemoProfile } from './trusted-profile.js';
import { usePolling } from './use-polling.js';
import type { DemoAnchorDto, DemoReceiptDto } from './demo-decision-dto.js';
import { DecisionDetailView } from './DecisionDetailView.js';

const POLL_INTERVAL_MS = 1000;

export interface DecisionDetailClientProps {
  readonly decisionId: string;
  readonly bffClient: DecisionBffClient;
  /** Optional link to a dedicated live validator-progress sub-page. */
  readonly validatorsHref?: string;
}

/** Shared client-side polling and local-verification orchestration for the
 * public reference surfaces. */
export function DecisionDetailClient({ decisionId, bffClient, validatorsHref }: DecisionDetailClientProps): JSX.Element {
  const statusState = usePolling(() => bffClient.fetchDecisionStatus(decisionId), {
    intervalMs: POLL_INTERVAL_MS,
    enabled: true,
    isTerminal: (data) => isTerminalDecisionStatus(data.status),
  });

  const validatorsState = usePolling(() => bffClient.fetchValidatorProgress(decisionId), {
    intervalMs: POLL_INTERVAL_MS,
    enabled: true,
    isTerminal: (data) => data.validators.length > 0 && data.validators.every((v) => isTerminalValidatorPhase(v.phase)),
  });

  const decisionFinalized = statusState.status === 'loaded' && statusState.data.status === 'FINALIZED';

  const [receiptState, setReceiptState] = useState<FetchState<DemoReceiptDto>>(idle());
  const [anchorState, setAnchorState] = useState<FetchState<DemoAnchorDto>>(idle());
  const [localVerification, setLocalVerification] = useState<VerificationOutcomeResult | undefined>(undefined);

  useEffect(() => {
    if (!decisionFinalized || receiptState.status !== 'idle') return;
    setReceiptState(loading());
    bffClient
      .fetchReceipt(decisionId)
      .then((dto) => setReceiptState(loaded(dto)))
      .catch((error: unknown) => setReceiptState(errored(error instanceof Error ? error.message : String(error))));
  }, [decisionFinalized, decisionId, receiptState.status]);

  async function refreshAnchor(): Promise<void> {
    setAnchorState(loading());
    try {
      const dto = await bffClient.fetchAnchor(decisionId);
      setAnchorState(loaded(dto));
    } catch (error) {
      setAnchorState(errored(error instanceof Error ? error.message : String(error)));
    }
  }

  useEffect(() => {
    if (!decisionFinalized || anchorState.status !== 'idle') return;
    void refreshAnchor();
  }, [decisionFinalized]);

  useEffect(() => {
    if (receiptState.status !== 'loaded' || receiptState.data.receipt === undefined) {
      setLocalVerification(undefined);
      return;
    }
    const receipt = receiptState.data.receipt;
    const anchor = anchorState.status === 'loaded' ? anchorState.data.anchor : undefined;
    const profile = getTrustedDemoProfile();
    const chainReader = anchor ? createDemoChainReader(getChainRpcUrl(), profile) : undefined;
    let cancelled = false;
    computeVerificationOutcome(receipt, profile.validatorSet, anchor, chainReader).then((result) => {
      if (!cancelled) setLocalVerification(result);
    });
    return () => {
      cancelled = true;
    };
  }, [receiptState, anchorState]);

  return (
    <div>
      {validatorsHref && (
        <p>
          <a href={validatorsHref}>Watch live validator progress</a>
        </p>
      )}
      <DecisionDetailView
        decisionId={decisionId}
        statusState={statusState}
        validatorsState={validatorsState}
        receiptState={receiptState}
        anchorState={anchorState}
        localVerification={localVerification}
      />
      {decisionFinalized && (
        <button type="button" onClick={() => void refreshAnchor()}>
          Refresh anchor status
        </button>
      )}
    </div>
  );
}
