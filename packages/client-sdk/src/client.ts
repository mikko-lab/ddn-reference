// SPDX-License-Identifier: Apache-2.0
// The thin HTTP client: every method calls exactly one DDN API v1
// endpoint and parses the response through @ddn/schemas' own parsers, so
// a malformed/unexpected server response is never blindly trusted just
// because it arrived with a 2xx status. Uses native fetch (Node 22+) --
// no HTTP client dependency.

import {
  parseApiErrorResponseV1,
  parseDecisionStatusResponseV1,
  parseGetAnchorResponseV1,
  parsePolicyDetailResponseV1,
  parsePolicyListResponseV1,
  parseValidatorProgressResponseV1,
  parseVerifyReceiptResponseV1,
  type DecisionStatusResponseV1,
  type GetAnchorResponseV1,
  type PolicyDetailResponseV1,
  type PolicyListResponseV1,
  type SubmitDecisionRequestV1,
  type ValidatorProgressResponseV1,
  type VerifyReceiptResponseV1,
} from '@ddn/schemas';
import { parseDecisionReceiptV1, type DecisionReceiptV1 } from '@ddn/receipt-sdk';
import { DdnApiError, DdnNetworkError } from './errors.js';

export type FetchLike = typeof fetch;

export interface DdnClientConfig {
  readonly baseUrl: string;
  readonly serviceToken: string;
  /** Defaults to the global `fetch`. Overridable for tests. */
  readonly fetchImpl?: FetchLike;
  /** Number of retries for network errors and 5xx responses. Does not
   * retry 4xx responses -- a client mistake is not fixed by retrying it.
   * Default 3. */
  readonly maxRetries?: number;
  /** Base delay for exponential backoff between retries, in ms. Default
   * 250 (so retries land at ~250ms, ~500ms, ~1000ms). */
  readonly retryDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DdnClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config: DdnClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.serviceToken = config.serviceToken;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.serviceToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    let lastNetworkError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (error) {
        lastNetworkError = error;
        if (attempt < this.maxRetries) {
          await sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }
        throw new DdnNetworkError(
          `network error calling ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (res.status >= 500 && attempt < this.maxRetries) {
        await sleep(this.retryDelayMs * 2 ** attempt);
        continue;
      }

      const payload: unknown = await res.json();
      if (res.status >= 400) {
        throw new DdnApiError(parseApiErrorResponseV1(payload), res.status);
      }
      return payload;
    }
    // Unreachable in practice (the loop always returns or throws), but
    // keeps this function's return type honest for the type checker.
    throw new DdnNetworkError(
      `network error calling ${method} ${path}: ${lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError)}`
    );
  }

  async submitDecision(request: SubmitDecisionRequestV1): Promise<DecisionStatusResponseV1> {
    return parseDecisionStatusResponseV1(await this.request('POST', '/v1/decisions', request));
  }

  async getDecision(decisionId: string): Promise<DecisionStatusResponseV1> {
    return parseDecisionStatusResponseV1(await this.request('GET', `/v1/decisions/${encodeURIComponent(decisionId)}`));
  }

  /** The raw DecisionReceiptV1 -- not a summary. Callers that need a
   * verified answer must run @ddn/receipt-sdk's verifyDecisionReceipt on
   * this themselves (or use submitWaitAndVerify, which does). */
  async getDecisionReceipt(decisionId: string): Promise<DecisionReceiptV1> {
    return parseDecisionReceiptV1(await this.request('GET', `/v1/decisions/${encodeURIComponent(decisionId)}/receipt`));
  }

  /** The raw AnchorRecordV1 wire shape -- only present once the decision's
   * receipt has been confirmed on-chain (409 ANCHOR_NOT_AVAILABLE
   * otherwise, surfaced as a DdnApiError). Not itself a verified answer:
   * callers that need one must run @ddn/receipt-sdk's
   * verifyAnchoredDecisionReceipt on this themselves (or use
   * fetchAndVerifyAnchor, which does). See docs/anchor-v1.md. */
  async getDecisionAnchor(decisionId: string): Promise<GetAnchorResponseV1> {
    return parseGetAnchorResponseV1(await this.request('GET', `/v1/decisions/${encodeURIComponent(decisionId)}/anchor`));
  }

  /** Milestone 7: real per-validator progress, for a live status view --
   * never signatures or raw output, and never a substitute for the
   * receipt itself once FINALIZED. See docs/public-demo-boundary.md. */
  async getValidatorProgress(decisionId: string): Promise<ValidatorProgressResponseV1> {
    return parseValidatorProgressResponseV1(await this.request('GET', `/v1/decisions/${encodeURIComponent(decisionId)}/validators`));
  }

  /** A convenience server-side re-check, never a substitute for local
   * verification -- see submitWaitAndVerify and docs/api-v1.md. */
  async verifyReceiptRemotely(receipt: unknown): Promise<VerifyReceiptResponseV1> {
    return parseVerifyReceiptResponseV1(await this.request('POST', '/v1/receipts/verify', { schemaVersion: '1.0.0', receipt }));
  }

  async listPolicies(): Promise<PolicyListResponseV1> {
    return parsePolicyListResponseV1(await this.request('GET', '/v1/policies'));
  }

  async getPolicy(policyId: string, policyVersion: string): Promise<PolicyDetailResponseV1> {
    return parsePolicyDetailResponseV1(
      await this.request('GET', `/v1/policies/${encodeURIComponent(policyId)}/${encodeURIComponent(policyVersion)}`)
    );
  }
}
