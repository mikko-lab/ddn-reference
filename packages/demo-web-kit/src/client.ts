// SPDX-License-Identifier: Apache-2.0
// @ddn/demo-web-kit/client
//
// The React-hook/'use client'-component half of @ddn/demo-web-kit --
// import from here only in 'use client' page/component files, never from
// a Route Handler (route.ts). Kept in a separate entry point from the
// package root specifically so Next.js's bundler never has to reason
// about hook-using code being reachable from a server-only context; see
// index.ts's own comment for why that matters. See docs/public-demo-boundary.md.

export { usePolling } from './use-polling.js';
export type { UsePollingOptions } from './use-polling.js';

export { getTrustedDemoProfile } from './trusted-profile.js';

export { DecisionDetailView } from './DecisionDetailView.js';
export type { DecisionDetailViewProps } from './DecisionDetailView.js';

export { ValidatorStatusView } from './ValidatorStatusView.js';
export type { ValidatorStatusViewProps } from './ValidatorStatusView.js';

export { DecisionDetailClient } from './DecisionDetailClient.js';
export type { DecisionDetailClientProps } from './DecisionDetailClient.js';
