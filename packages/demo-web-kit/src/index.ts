// SPDX-License-Identifier: Apache-2.0
// @ddn/demo-web-kit
//
// Shared data-fetching, DTO and mapping utilities for the public reference
// explorer and synthetic negotiation flow.
//
// This entry point is deliberately free of React hooks and 'use client'
// components -- safe to import from a Route Handler (Next.js Route
// Handlers run in a plain server context, not the React Server Components
// tree, but Next's bundler still refuses to let ANY hook-using module be
// reachable from one at all, even transitively through a shared barrel).
// The hook/component pieces (usePolling, DecisionDetailView,
// DecisionDetailClient, the trusted-profile loader) live in
// './client.js' (@ddn/demo-web-kit/client) instead -- import from there
// only in 'use client' page/component files, never from a route.ts.
// See docs/public-demo-boundary.md.

export { idle, loading, errored, loaded } from './fetch-state.js';
export type { FetchState } from './fetch-state.js';

export { createRateLimiter } from './rate-limiter.js';
export type { RateLimiter, RateLimiterConfig } from './rate-limiter.js';

export { isValidDecisionId } from './decision-id.js';

export { createDecisionBffClient } from './decision-bff-client.js';
export type { DecisionBffClient, DecisionBffClientOptions } from './decision-bff-client.js';

export { DEMO_BFF_ERROR_CODES } from './demo-decision-dto.js';
export type {
  DemoBffErrorCode,
  DemoBffErrorDto,
  DemoDecisionStatusDto,
  DemoDecisionPendingDto,
  DemoDecisionFinalizedDto,
  DemoDecisionErrorDto,
  DemoDecisionVerificationSummaryDto,
  DemoValidatorPhaseDto,
  DemoValidatorProgressEntryDto,
  DemoValidatorProgressDto,
  DemoReceiptDto,
  DemoAnchorDto,
} from './demo-decision-dto.js';

export {
  toDemoDecisionStatusDto,
  toDemoValidatorProgressDto,
  toDemoReceiptDto,
  toDemoAnchorDto,
  isTerminalValidatorPhase,
  isTerminalDecisionStatus,
} from './demo-decision-mapper.js';

export { isApiErrorWithCode, mapUpstreamError } from './demo-bff-error-mapping.js';
export type { MappedBffError } from './demo-bff-error-mapping.js';

export { getChainRpcUrl, DEFAULT_DEMO_CHAIN_RPC_URL } from './chain-rpc-url.js';
