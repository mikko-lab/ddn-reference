// SPDX-License-Identifier: Apache-2.0
// POST /v1/receipts/verify: a convenience server-side re-check using the
// exact same @ddn/receipt-sdk verification an external client can (and,
// per docs/api-v1.md, must) run locally -- this endpoint is never the
// client's sole basis for trusting a receipt, only a diagnostic aid.

import type { FastifyInstance } from 'fastify';
import { parseVerifyReceiptRequestV1 } from '@ddn/schemas';
import { verifyDecisionReceipt } from '@ddn/receipt-sdk';
import { requireAuth } from '../auth/authenticate.js';
import type { AppDependencies } from '../dependencies.js';
import { loadTrustedValidatorSet } from '../policies/validator-set-loader.js';

export function registerReceiptRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/v1/receipts/verify', { preHandler: requireAuth(deps.config, ['receipt:verify']) }, async (req) => {
    const body = parseVerifyReceiptRequestV1(req.body);
    const validatorSet = await loadTrustedValidatorSet(deps.config.validatorSetPath);
    const result = verifyDecisionReceipt(body.receipt, validatorSet);

    return {
      schemaVersion: '1.0.0',
      status: result.ok ? 'VALID' : 'INVALID',
      checks: result.checks,
      // ok implies the schemaValid check (the first one run) passed, so
      // body.receipt is known to have a well-formed receiptId.
      ...(result.ok ? { receiptId: (body.receipt as { receiptId: string }).receiptId } : {}),
    };
  });
}
