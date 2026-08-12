// SPDX-License-Identifier: Apache-2.0
import { toDemoValidatorProgressDto } from '@ddn/demo-web-kit';
import { handleDemoBffGet } from '../../../../../../server/demo-bff-handler';

export async function GET(request: Request, context: { params: Promise<{ decisionId: string }> }): Promise<Response> {
  const { decisionId } = await context.params;
  return handleDemoBffGet(request, decisionId, async (client) => {
    const response = await client.getValidatorProgress(decisionId);
    return toDemoValidatorProgressDto(decisionId, response);
  });
}
