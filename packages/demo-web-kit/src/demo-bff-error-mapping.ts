// SPDX-License-Identifier: Apache-2.0
// Maps whatever @ddn/client-sdk throws onto this app's own small,
// generic DemoBffErrorDto vocabulary -- never forwards the upstream
// error's own message/requestId/code to the browser. Pure (no network
// call itself) so it's directly unit-testable against constructed error
// instances.
//
// Deliberately checks `error.name` (duck typing) instead of `instanceof
// DdnApiError`/`instanceof DdnNetworkError` -- importing those classes as
// VALUES (not just types) from @ddn/client-sdk pulls in its whole module
// graph, which transitively reaches @ddn/schemas' node:fs-based JSON
// schema loading. That's harmless for this package's server-only root
// export, but this file is also reachable from apps/explorer's client
// bundle (via DecisionDetailClient -> demo-decision-mapper's sibling
// exports), and Next.js/Turbopack refuses to bundle node:fs into a
// browser chunk at all -- confirmed by hand: switching from `instanceof`
// to this shape check is what fixed a real
// "the chunking context (unknown) does not support external modules
// (request: node:fs)" build failure.
//
// DECISION_NOT_FOUND is deliberately the only upstream 4xx that reaches
// the browser as anything other than SERVICE_UNAVAILABLE/UPSTREAM_ERROR:
// UNAUTHORIZED/FORBIDDEN mean the demo's OWN configured service token is
// broken (an operator problem, not something a visitor caused) and must
// never be described to a client as if their request were at fault.
// RECEIPT_NOT_AVAILABLE/ANCHOR_NOT_AVAILABLE are handled by each route's
// own caller before ever reaching this function -- they are valid,
// non-error "not ready yet" states, not failures.

import type { DemoBffErrorDto } from './demo-decision-dto.js';

export interface MappedBffError {
  readonly status: number;
  readonly dto: DemoBffErrorDto;
}

interface ApiErrorShape {
  readonly name: 'DdnApiError';
  readonly code: string;
}

function isDdnApiError(error: unknown): error is ApiErrorShape {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'DdnApiError' && typeof (error as { code?: unknown }).code === 'string';
}

function isDdnNetworkError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'DdnNetworkError';
}

function errorDto(code: DemoBffErrorDto['error']['code'], message: string): DemoBffErrorDto {
  return { error: { code, message } };
}

/** True when `error` is a DdnApiError carrying exactly `code` -- lets
 * route handlers special-case a "not ready yet" upstream code (e.g.
 * RECEIPT_NOT_AVAILABLE, ANCHOR_NOT_AVAILABLE) as a valid, non-error
 * state without importing DdnApiError themselves. */
export function isApiErrorWithCode(error: unknown, code: string): boolean {
  return isDdnApiError(error) && error.code === code;
}

export function mapUpstreamError(error: unknown): MappedBffError {
  if (isDdnApiError(error)) {
    if (error.code === 'DECISION_NOT_FOUND') {
      return { status: 404, dto: errorDto('NOT_FOUND', 'no such decision') };
    }
    if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') {
      return { status: 503, dto: errorDto('SERVICE_UNAVAILABLE', 'the demo backend is not configured correctly') };
    }
    return { status: 502, dto: errorDto('UPSTREAM_ERROR', 'the demo backend returned an unexpected error') };
  }
  if (isDdnNetworkError(error)) {
    return { status: 502, dto: errorDto('UPSTREAM_ERROR', 'could not reach the demo backend') };
  }
  return { status: 502, dto: errorDto('UPSTREAM_ERROR', 'an unexpected error occurred') };
}
