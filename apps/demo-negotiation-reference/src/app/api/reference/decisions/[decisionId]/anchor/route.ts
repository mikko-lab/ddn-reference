// SPDX-License-Identifier: Apache-2.0
import { parseAnchorRecordV1 } from '@ddn/receipt-sdk';
import { isApiErrorWithCode, toDemoAnchorDto } from '@ddn/demo-web-kit';
import { handleReferenceBffGet } from '../../../../../../server/reference-bff-handler';

export async function GET(request: Request, context: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  const { decisionId } = await context.params;
  return handleReferenceBffGet(request, decisionId, async (client) => {
    try {
      const wire = await client.getDecisionAnchor(decisionId);
      const anchor = parseAnchorRecordV1(wire);
      return toDemoAnchorDto(decisionId, anchor);
    } catch (error) {
      if (isApiErrorWithCode(error, 'ANCHOR_NOT_AVAILABLE')) {
        return toDemoAnchorDto(decisionId, undefined);
      }
      throw error;
    }
  });
}
