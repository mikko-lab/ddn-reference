// SPDX-License-Identifier: Apache-2.0
// Shared factory for same-origin, read-only decision BFF clients. Callers
// provide the route prefix and may inject an unauthorized-response handler;
// this public package contains no product-specific route or login behavior.

import type { DemoAnchorDto, DemoBffErrorDto, DemoDecisionStatusDto, DemoReceiptDto, DemoValidatorProgressDto } from './demo-decision-dto.js';

export interface DecisionBffClient {
  fetchDecisionStatus(decisionId: string): Promise<DemoDecisionStatusDto>;
  fetchValidatorProgress(decisionId: string): Promise<DemoValidatorProgressDto>;
  fetchReceipt(decisionId: string): Promise<DemoReceiptDto>;
  fetchAnchor(decisionId: string): Promise<DemoAnchorDto>;
}

export interface DecisionBffClientOptions {
  readonly onUnauthorized?: () => void;
}

async function getJson<T>(path: string, options: DecisionBffClientOptions): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  const body: unknown = await res.json();
  if (!res.ok) {
    if (res.status === 401) options.onUnauthorized?.();
    const message = (body as Partial<DemoBffErrorDto>).error?.message ?? 'request failed';
    throw new Error(message);
  }
  return body as T;
}

export function createDecisionBffClient(basePath: string, options: DecisionBffClientOptions = {}): DecisionBffClient {
  return {
    fetchDecisionStatus: (decisionId) => getJson(`${basePath}/${encodeURIComponent(decisionId)}`, options),
    fetchValidatorProgress: (decisionId) => getJson(`${basePath}/${encodeURIComponent(decisionId)}/validators`, options),
    fetchReceipt: (decisionId) => getJson(`${basePath}/${encodeURIComponent(decisionId)}/receipt`, options),
    fetchAnchor: (decisionId) => getJson(`${basePath}/${encodeURIComponent(decisionId)}/anchor`, options),
  };
}
