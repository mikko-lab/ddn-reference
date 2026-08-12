// SPDX-License-Identifier: Apache-2.0
import { isApiErrorWithCode, toDemoReceiptDto } from '@ddn/demo-web-kit';
import { handleDemoBffGet } from '../../../../../../server/demo-bff-handler';

export async function GET(request: Request, context: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  const { decisionId } = await context.params;
  return handleDemoBffGet(request, decisionId, async (client) => {
    try {
      const receipt = await client.getDecisionReceipt(decisionId);
      return toDemoReceiptDto(decisionId, receipt);
    } catch (error) {
      // Not finalized yet -- a valid, non-error state, not a failure.
      if (isApiErrorWithCode(error, 'RECEIPT_NOT_AVAILABLE')) {
        return toDemoReceiptDto(decisionId, undefined);
      }
      throw error;
    }
  });
}
