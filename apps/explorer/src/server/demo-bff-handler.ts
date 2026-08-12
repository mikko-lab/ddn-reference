// SPDX-License-Identifier: Apache-2.0
import 'server-only';
// Shared orchestration for every /api/demo/decisions/... route handler:
// decisionId shape validation, per-IP rate limiting, fail-closed config
// check, then the caller's own upstream call wrapped in generic error
// mapping. See demo-bff-config.ts and docs/public-demo-boundary.md.

import type { DdnClient } from '@ddn/client-sdk';
import { createRateLimiter, isValidDecisionId, mapUpstreamError, type DemoBffErrorDto } from '@ddn/demo-web-kit';
import { getDemoBffClient } from './demo-bff-config';

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

/** Runs `fetchDto` only after decisionId shape validation, rate limiting,
 * and a fail-closed configuration check all pass -- and only ever sends
 * the browser a DemoBffErrorDto or whatever plain object `fetchDto`
 * resolves to, never a raw upstream error. */
export async function handleDemoBffGet<T>(
  request: Request,
  decisionId: string,
  fetchDto: (client: DdnClient) => Promise<T>
): Promise<Response> {
  if (!isValidDecisionId(decisionId)) {
    return jsonError(400, { error: { code: 'INVALID_DECISION_ID', message: 'decisionId is not well-formed' } });
  }
  if (!limiter.check(clientKeyFrom(request))) {
    return jsonError(429, { error: { code: 'RATE_LIMITED', message: 'too many requests -- slow down' } });
  }
  const client = getDemoBffClient();
  if (!client) {
    console.error('DDN demo BFF is not configured: set DDN_API_BASE_URL and DDN_DEMO_SERVICE_TOKEN');
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
