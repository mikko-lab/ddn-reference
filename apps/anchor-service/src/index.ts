// SPDX-License-Identifier: Apache-2.0
// @ddn/anchor-service
//
// Milestone 6: an in-process anchoring component, not a separate process --
// apps/api constructs and injects it exactly the way it already constructs
// and injects @ddn/coordinator's decide() (see apps/api/src/server.ts).
// No HTTP interface, no service token: the worker reads FinalizedDecisionRecord.receipt
// directly off the same in-memory DecisionRepository instance it shares a
// process with. See docs/decisions/ADR-001-no-custom-blockchain.md and the
// Milestone 6 "strictly local" cross-process-handoff design for why -- an
// apps/api restart loses all anchor sidecar state exactly as it already
// loses all decision state, and only one apps/api process may run at a
// time. Durable, multi-instance operation is explicitly out of scope.

export { AnchorSidecarStore, AnchorSidecarError, ALLOWED_ANCHOR_TRANSITIONS } from './sidecar-store.js';
export type { AnchorSidecarEntry, AnchorSidecarStatus, AnchorSidecarErrorCode } from './sidecar-store.js';

export { AnchorChainClient, AnchorKeyConfigurationError } from './chain-client.js';
export type {
  AnchorChainClientConfig,
  AnchorChainClientLike,
  SubmittedBatch,
  TransactionOutcome,
  BlockInfo,
  AnchoredEvent,
} from './chain-client.js';

export { AnchorWorker } from './worker.js';
export type { AnchorWorkerConfig } from './worker.js';

// DECISION_ANCHOR_ABI and the bytes32<->Sha256Digest helpers now live in
// @ddn/receipt-sdk (Milestone 7: @ddn/demo-trust-profile needs the same
// ABI/conversion to build a ChainReader for the explorer, so there is one
// canonical definition instead of two) -- re-exported here so nothing that
// already imports them from @ddn/anchor-service breaks.
export { DECISION_ANCHOR_ABI, Bytes32ConversionError, sha256DigestToBytes32, bytes32ToSha256Digest } from '@ddn/receipt-sdk';
