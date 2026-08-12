// SPDX-License-Identifier: Apache-2.0
import { isApiErrorWithCode, toDemoReceiptDto } from '@ddn/demo-web-kit';
import { handleReferenceBffGet } from '../../../../../../server/reference-bff-handler';

export async function GET(request: Request, context: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  const { decisionId } = await context.params;
  return handleReferenceBffGet(request, decisionId, async (client) => {
    try {
      const receipt = await client.getDecisionReceipt(decisionId);
      return toDemoReceiptDto(decisionId, receipt);
    } catch (error) {
      if (isApiErrorWithCode(error, 'RECEIPT_NOT_AVAILABLE')) {
        return toDemoReceiptDto(decisionId, undefined);
      }
      throw error;
    }
  });
}
