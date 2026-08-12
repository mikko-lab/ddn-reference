// SPDX-License-Identifier: Apache-2.0
import { createRateLimiter } from '@ddn/demo-web-kit';
import { OfferInputError, parseOfferFormInput } from '../../../lib/offer-input';
import { buildValidatedSubmitDecisionRequest } from '../../../lib/offer-input-server';
import { hasJsonContentType, isAllowedOrigin, isBodyWithinLimit, isDeclaredSizeWithinLimit } from '../../../lib/request-guards';
import { getReferenceBffClient } from '../../../server/reference-bff-config';

// Reference flow: the browser submits a synthetic offer and this backend
// sends the corresponding DDN request (docs/negotiation-policy-v1.md).
// Returns immediately with the new decisionId -- the
// frontend then watches it live via the /api/reference/decisions/...
// read routes (steps 3-7), the same real-polling pattern as
// apps/explorer's decision-detail page, never a simulated progress bar.
//
// Abuse/security posture for this public, unauthenticated route (task
// #56 follow-up hardening):
// - a stricter rate limit than the read routes (10/60s per IP): this
//   triggers real validator subprocess work per request, not a cache
//   lookup.
// - only POST is exported, so Next.js itself returns 405 for any other
//   method.
// - Content-Type must be exactly application/json.
// - the request body is capped (both the declared Content-Length and the
//   actually-read length) well above what a real offer ever needs.
// - in production, a browser request whose Origin header names a
//   different origin is rejected (no cookie/session exists here for a
//   foreign page to piggyback on, but this still bounds a foreign page
//   silently driving a visitor's browser at this endpoint).
// - the request body is parsed into exactly four named fields
//   (sessionId, customerOfferCents, offerNumber,
//   conditionReportAcknowledged, see parseOfferFormInput) -- nothing
//   else in the body (tenantId, policyId/policyVersion, internal ids, a
//   whole wire request) is ever read, let alone forwarded.
// - the DDN request is built only from that validated OfferFormInput,
//   through buildValidatedSubmitDecisionRequest, which also runs
//   @ddn/schemas' own validateNegotiationInputV1 over the fully
//   constructed input before it is ever submitted.
// - missing DDN_API_BASE_URL/DDN_DEMO_REFERENCE_SERVICE_TOKEN fails
//   every request closed with 503, never a default/unauthenticated
//   fallback.
// - upstream errors are mapped to one generic message/code; the raw
//   error (which could carry upstream detail) is never included in the
//   response NOR logged.

const OFFER_RATE_LIMIT_CONFIG = { windowMs: 60_000, maxRequestsPerWindow: 10 };
const limiter = createRateLimiter(OFFER_RATE_LIMIT_CONFIG);
const MAX_BODY_BYTES = 4096;

function clientKeyFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown';
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!limiter.check(clientKeyFrom(request))) {
    return jsonError(429, 'RATE_LIMITED', 'too many offers -- slow down');
  }

  if (process.env.NODE_ENV === 'production') {
    const expectedOrigin = new URL(request.url).origin;
    if (!isAllowedOrigin(request.headers.get('origin'), expectedOrigin)) {
      return jsonError(403, 'FORBIDDEN_ORIGIN', 'cross-origin requests are not allowed');
    }
  }

  if (!hasJsonContentType(request.headers.get('content-type'))) {
    return jsonError(415, 'INVALID_REQUEST', 'Content-Type must be application/json');
  }
  if (!isDeclaredSizeWithinLimit(request.headers.get('content-length'), MAX_BODY_BYTES)) {
    return jsonError(413, 'INVALID_REQUEST', 'request body too large');
  }

  const client = getReferenceBffClient();
  if (!client) {
    console.error('demo-reference offer flow is not configured: set DDN_API_BASE_URL and DDN_DEMO_REFERENCE_SERVICE_TOKEN');
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'the demo backend is not configured');
  }

  const rawBody = await request.text();
  if (!isBodyWithinLimit(rawBody, MAX_BODY_BYTES)) {
    return jsonError(413, 'INVALID_REQUEST', 'request body too large');
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'malformed request body');
  }

  let offer: ReturnType<typeof parseOfferFormInput>;
  try {
    offer = parseOfferFormInput(body);
  } catch (error) {
    if (error instanceof OfferInputError) {
      return jsonError(400, error.code, error.message);
    }
    throw error;
  }

  try {
    const submitRequest = buildValidatedSubmitDecisionRequest(offer);
    const status = await client.submitDecision(submitRequest);
    return Response.json({ decisionId: status.decisionId, status: status.status }, { status: 201 });
  } catch (error) {
    if (error instanceof OfferInputError) {
      return jsonError(400, error.code, error.message);
    }
    return jsonError(502, 'UPSTREAM_ERROR', 'the demo backend returned an unexpected error');
  }
}
