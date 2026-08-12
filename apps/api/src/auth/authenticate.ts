// SPDX-License-Identifier: Apache-2.0
// Fastify preHandler factory for service-token auth + role checks. Every
// route that touches decisions/receipts/policies must run this before its
// handler; the handler then reads the principal back via getPrincipal
// rather than re-deriving it, so there is exactly one place auth happens.

import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.js';
import { ApiError } from '../errors/api-error.js';
import { findServiceTokenPrincipal } from './token-registry.js';
import type { ServiceRole, ServiceTokenPrincipal } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: ServiceTokenPrincipal;
  }
}

const BEARER_PREFIX = 'Bearer ';

function extractBearerToken(header: string | undefined): string {
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new ApiError('UNAUTHORIZED', 'missing or malformed Authorization header');
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) {
    throw new ApiError('UNAUTHORIZED', 'missing bearer token');
  }
  return token;
}

export function requireAuth(config: ApiConfig, requiredRoles: readonly ServiceRole[]) {
  return async function authenticate(req: FastifyRequest): Promise<void> {
    const token = extractBearerToken(req.headers.authorization);
    const principal = findServiceTokenPrincipal(config, token);
    if (!principal) {
      throw new ApiError('UNAUTHORIZED', 'invalid service token');
    }
    for (const role of requiredRoles) {
      if (!principal.roles.includes(role)) {
        throw new ApiError('FORBIDDEN', `service token is missing required role: ${role}`);
      }
    }
    req.principal = principal;
  };
}

export function getPrincipal(req: FastifyRequest): ServiceTokenPrincipal {
  if (!req.principal) {
    throw new ApiError('INTERNAL_ERROR', 'request handler ran without an authenticated principal');
  }
  return req.principal;
}
