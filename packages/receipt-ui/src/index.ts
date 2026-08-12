// SPDX-License-Identifier: Apache-2.0
// @ddn/receipt-ui
//
// Shared, presentational React components used by the public verifier and
// synthetic negotiation reference. They perform no data fetching, session
// handling or configuration. Callers pass already-fetched, already-typed
// @ddn/receipt-sdk shapes as props. See docs/public-demo-boundary.md.

export { describeVerificationOutcome } from './verification-outcome.js';
export type { VerificationOutcome, VerificationOutcomeTone, VerificationOutcomeDescription } from './verification-outcome.js';

export { VerificationOutcomeBadge } from './VerificationOutcomeBadge.js';
export type { VerificationOutcomeBadgeProps } from './VerificationOutcomeBadge.js';

export { LabeledValue } from './LabeledValue.js';
export type { LabeledValueProps } from './LabeledValue.js';

export { ReceiptSummary } from './ReceiptSummary.js';
export type { ReceiptSummaryProps } from './ReceiptSummary.js';

export { QuorumSummary } from './QuorumSummary.js';
export type { QuorumSummaryProps } from './QuorumSummary.js';

export { ValidatorSignatureList } from './ValidatorSignatureList.js';
export type { ValidatorSignatureListProps } from './ValidatorSignatureList.js';

export { AnchorStatusView } from './AnchorStatusView.js';
export type { AnchorStatusViewProps } from './AnchorStatusView.js';

export { ValidatorProgressList } from './ValidatorProgressList.js';
export type { ValidatorProgressListProps, ValidatorProgressEntry, ValidatorProgressPhase } from './ValidatorProgressList.js';
