// SPDX-License-Identifier: Apache-2.0
import { parseAnchorRecordV1 } from '@ddn/receipt-sdk';
import { isApiErrorWithCode, toDemoAnchorDto } from '@ddn/demo-web-kit';
import { handleDemoBffGet } from '../../../../../../server/demo-bff-handler';

export async function GET(request: Request, context: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  const { decisionId } = await context.params;
  return handleDemoBffGet(request, decisionId, async (client) => {
    try {
      // getDecisionAnchor returns @ddn/schemas' wire shape (plain strings);
      // re-parse through @ddn/receipt-sdk's own AnchorRecordV1 parser
      // rather than trusting it as already the branded, validated shape.
      const wire = await client.getDecisionAnchor(decisionId);
      const anchor = parseAnchorRecordV1(wire);
      return toDemoAnchorDto(decisionId, anchor);
    } catch (error) {
      // Not anchored yet -- decoupled from decision finality
      // (ADR-001/ADR-005), a valid, non-error state, not a failure.
      if (isApiErrorWithCode(error, 'ANCHOR_NOT_AVAILABLE')) {
        return toDemoAnchorDto(decisionId, undefined);
      }
      throw error;
    }
  });
}
