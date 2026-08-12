// SPDX-License-Identifier: Apache-2.0
// @ddn/client-sdk: a workspace TypeScript reference client for DDN HTTP API v1.
// Deliberately depends only on @ddn/schemas (the wire contract types) and
// @ddn/receipt-sdk (offline receipt verification) -- never @ddn/coordinator,
// never the ddn-validator binary, never a private key. See
// submit-wait-and-verify.ts for why that boundary is the entire point of
// this package.

export { DdnClient } from './client.js';
export type { DdnClientConfig, FetchLike } from './client.js';
export { submitWaitAndVerify } from './submit-wait-and-verify.js';
export type { SubmitWaitAndVerifyOptions, SubmitWaitAndVerifyResult } from './submit-wait-and-verify.js';
export { fetchAndVerifyAnchor } from './fetch-and-verify-anchor.js';
export type { FetchAndVerifyAnchorOptions, FetchAndVerifyAnchorResult } from './fetch-and-verify-anchor.js';
export {
  DdnAnchorVerificationError,
  DdnApiError,
  DdnClientError,
  DdnDecisionFailedError,
  DdnNetworkError,
  DdnReceiptVerificationError,
  DdnTimeoutError,
} from './errors.js';
