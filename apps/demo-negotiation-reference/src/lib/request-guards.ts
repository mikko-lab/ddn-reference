// SPDX-License-Identifier: Apache-2.0
// Pure, framework-agnostic request guards for POST /api/offer -- kept
// free of any server-only import so they're directly unit-testable
// without a real Next.js request. See docs/public-demo-boundary.md.

const JSON_CONTENT_TYPE = 'application/json';

/** True only when the Content-Type header is exactly application/json
 * (ignoring an optional charset parameter) -- rejects text/plain,
 * multipart/form-data, missing headers, etc. */
export function hasJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const [mediaType] = contentType.split(';');
  return mediaType?.trim().toLowerCase() === JSON_CONTENT_TYPE;
}

/** True when a stated Content-Length is present, parses as a
 * non-negative integer, and does not exceed maxBytes. A missing or
 * unparsable Content-Length is NOT trusted as "small" -- callers must
 * also check the actually-read body length (Content-Length is
 * caller-supplied and not verified by the runtime before headers are
 * read). */
export function isDeclaredSizeWithinLimit(contentLength: string | null, maxBytes: number): boolean {
  if (!contentLength) return false;
  const parsed = Number.parseInt(contentLength, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maxBytes;
}

export function isBodyWithinLimit(body: string, maxBytes: number): boolean {
  return Buffer.byteLength(body, 'utf8') <= maxBytes;
}

/** Same-origin check for a state-changing POST -- rejects a browser
 * request whose Origin header names a different origin than this
 * deployment's own. When `originHeader` is absent (a non-browser client,
 * e.g. a server-to-server call or curl), this returns true: the concern
 * this guards against is a foreign *browser* page silently driving a
 * visitor's browser at this endpoint, not API clients in general -- this
 * endpoint carries no cookie/session for a foreign page to piggyback on
 * in the first place. Only enforced by the caller in production. */
export function isAllowedOrigin(originHeader: string | null, expectedOrigin: string): boolean {
  if (!originHeader) return true;
  return originHeader === expectedOrigin;
}
