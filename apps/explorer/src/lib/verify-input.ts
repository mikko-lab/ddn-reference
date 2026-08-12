// SPDX-License-Identifier: Apache-2.0
// Parses the two JSON blobs a user pastes into the public verifier --
// receipt (required) and on-chain anchor record (optional, since
// anchoring is decoupled from decision finality; see ADR-001/ADR-005) --
// before handing them to @ddn/receipt-sdk's computeVerificationOutcome.
// Returns a discriminated result instead of throwing, so the page can
// render a specific message instead of an unhandled exception.

import { parseAnchorRecordV1, parseDecisionReceiptV1, type AnchorRecordV1, type DecisionReceiptV1 } from '@ddn/receipt-sdk';

export type ParsedVerifyInput =
  | { readonly ok: true; readonly receipt: DecisionReceiptV1; readonly anchorRecord: AnchorRecordV1 | undefined }
  | { readonly ok: false; readonly error: string };

function parseJson(raw: string, label: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: `${label} is not valid JSON.` };
  }
}

/** `anchorRaw` may be empty/whitespace-only -- that is a valid "no anchor
 * record supplied" input, not a parse error. */
export function parseVerifyInput(receiptRaw: string, anchorRaw: string): ParsedVerifyInput {
  if (receiptRaw.trim().length === 0) {
    return { ok: false, error: 'Paste or upload a receipt to verify.' };
  }

  const receiptJson = parseJson(receiptRaw, 'Receipt');
  if (!receiptJson.ok) return receiptJson;

  let receipt: DecisionReceiptV1;
  try {
    receipt = parseDecisionReceiptV1(receiptJson.value);
  } catch (error) {
    return { ok: false, error: `Receipt is malformed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const trimmedAnchor = anchorRaw.trim();
  if (trimmedAnchor.length === 0) {
    return { ok: true, receipt, anchorRecord: undefined };
  }

  const anchorJson = parseJson(trimmedAnchor, 'Anchor record');
  if (!anchorJson.ok) return anchorJson;

  let anchorRecord: AnchorRecordV1;
  try {
    anchorRecord = parseAnchorRecordV1(anchorJson.value);
  } catch (error) {
    return { ok: false, error: `Anchor record is malformed: ${error instanceof Error ? error.message : String(error)}` };
  }

  return { ok: true, receipt, anchorRecord };
}
