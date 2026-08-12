// SPDX-License-Identifier: Apache-2.0
// Builds a Fastify instance wired with every DDN API v1 route, given a
// fully assembled AppDependencies. Separate from server.ts so tests (and
// app.inject()-based contract tests) can build an app against fakes/
// fixtures without ever binding a real TCP port.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { AppDependencies } from './dependencies.js';
import { registerDecisionRoutes } from './decisions/routes.js';
import { registerErrorHandler } from './errors/error-handler.js';
import { registerHealthRoutes } from './health/routes.js';
import { registerPolicyRoutes } from './policies/routes.js';
import { registerReceiptRoutes } from './receipts/routes.js';

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: deps.config.maxRequestBytes });

  await app.register(cors, { origin: [...deps.config.corsAllowedOrigins] });

  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerDecisionRoutes(app, deps);
  registerReceiptRoutes(app, deps);
  registerPolicyRoutes(app, deps);

  return app;
}
