// SPDX-License-Identifier: Apache-2.0
import 'server-only';
// Shared orchestration for every /api/reference/decisions/... route
// handler -- the same shape as apps/explorer's demo-bff-handler.ts
// (decisionId validation, per-IP rate limiting, fail-closed config check,
// generic error mapping), using this app's own separate service token.
// Public, unauthenticated, like apps/explorer's read-only demo BFF -- a
// customer placing a demo offer has no login. See docs/public-demo-boundary.md.

import type { DdnClient } from '@ddn/client-sdk';
import { createRateLimiter, isValidDecisionId, mapUpstreamError, type DemoBffErrorDto } from '@ddn/demo-web-kit';
import { getReferenceBffClient } from './reference-bff-config';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 60;

const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxRequestsPerWindow: RATE_LIMIT_MAX_PER_WINDOW });

function clientKeyFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown';
}

function jsonError(status: number, dto: DemoBffErrorDto): Response {
  return Response.json(dto, { status });
}

export async function handleReferenceBffGet<T>(request: Request, decisionId: string, fetchDto: (client: DdnClient) => Promise<T>): Promise<Response> {
  if (!isValidDecisionId(decisionId)) {
    return jsonError(400, { error: { code: 'INVALID_DECISION_ID', message: 'decisionId is not well-formed' } });
  }
  if (!limiter.check(clientKeyFrom(request))) {
    return jsonError(429, { error: { code: 'RATE_LIMITED', message: 'too many requests -- slow down' } });
  }
  const client = getReferenceBffClient();
  if (!client) {
    console.error('demo-reference BFF is not configured: set DDN_API_BASE_URL and DDN_DEMO_REFERENCE_SERVICE_TOKEN');
    return jsonError(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'the demo backend is not configured' } });
  }
  try {
    const dto = await fetchDto(client);
    return Response.json(dto, { status: 200 });
  } catch (error) {
    const mapped = mapUpstreamError(error);
    return jsonError(mapped.status, mapped.dto);
  }
}
