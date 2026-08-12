// SPDX-License-Identifier: Apache-2.0
// Validates a decisionId's shape before it ever reaches the demo BFF's
// upstream call -- matches @ddn/api's own generateDecisionId format
// (apps/api/src/decisions/id.ts: `dec_<uuid v4-shaped>`). Rejecting a
// malformed id here means the demo backend's service token is never even
// asked about an input that could not possibly be a real decisionId.

const DECISION_ID_PATTERN = /^dec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidDecisionId(id: string): boolean {
  return DECISION_ID_PATTERN.test(id);
}
