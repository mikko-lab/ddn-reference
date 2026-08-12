// SPDX-License-Identifier: Apache-2.0
// GET /healthz: liveness only, no auth. Does not depend on the validator
// binary, policy registry, or validator set being reachable -- a health
// check that itself shells out to a subprocess is a liveness risk, not a
// liveness signal.

import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ status: 'ok' }));
}
