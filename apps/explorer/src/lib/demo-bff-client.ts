// SPDX-License-Identifier: Apache-2.0
// Thin client-side fetch wrappers for the public demo BFF routes
// (src/app/api/demo/decisions/...) -- every call is a real HTTP request to
// this app's own server, which in turn proxies to the real DDN API with a
// server-side-only token. Never calls the DDN API directly from the
// browser. See docs/public-demo-boundary.md.

import {
  createDecisionBffClient,
  type DemoAnchorDto,
  type DemoDecisionStatusDto,
  type DemoReceiptDto,
  type DemoValidatorProgressDto,
} from '@ddn/demo-web-kit';

const client = createDecisionBffClient('/api/demo/decisions');

export function fetchDemoDecisionStatus(decisionId: string): Promise<DemoDecisionStatusDto> {
  return client.fetchDecisionStatus(decisionId);
}

export function fetchDemoValidatorProgress(decisionId: string): Promise<DemoValidatorProgressDto> {
  return client.fetchValidatorProgress(decisionId);
}

export function fetchDemoReceipt(decisionId: string): Promise<DemoReceiptDto> {
  return client.fetchReceipt(decisionId);
}

export function fetchDemoAnchor(decisionId: string): Promise<DemoAnchorDto> {
  return client.fetchAnchor(decisionId);
}
