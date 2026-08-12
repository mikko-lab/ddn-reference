// SPDX-License-Identifier: Apache-2.0
import { toDemoValidatorProgressDto } from '@ddn/demo-web-kit';
import { handleReferenceBffGet } from '../../../../../../server/reference-bff-handler';

export async function GET(request: Request, context: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  const { decisionId } = await context.params;
  return handleReferenceBffGet(request, decisionId, async (client) => {
    const response = await client.getValidatorProgress(decisionId);
    return toDemoValidatorProgressDto(decisionId, response);
  });
}
