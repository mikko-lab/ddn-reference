// SPDX-License-Identifier: Apache-2.0
// Single Fastify error handler: every thrown ApiError (or unexpected
// error, mapped to INTERNAL_ERROR) becomes the same ApiErrorResponseV1
// shape, with requestId always populated from Fastify's own per-request
// id. Never includes a stack trace, file path, or anything else listed in
// docs/api-security-model.md's "never log/return" list.

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ApiSchemaValidationError } from '@ddn/schemas';
import { ApiError, httpStatusForCode, type ApiErrorCode } from './api-error.js';

export function registerErrorHandler(app: { setErrorHandler: (fn: (error: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => void) => void }): void {
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.httpStatus).send({
        schemaVersion: '1.0.0',
        error: {
          code: error.code,
          message: error.message,
          requestId: req.id,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }

    // parseSubmitDecisionRequestV1/parseVerifyReceiptRequestV1 (@ddn/schemas)
    // throw their own ApiSchemaValidationError, not this module's ApiError
    // -- same response shape, status looked up by the same code string.
    if (error instanceof ApiSchemaValidationError) {
      reply.status(httpStatusForCode(error.code)).send({
        schemaVersion: '1.0.0',
        error: { code: error.code, message: error.message, requestId: req.id },
      });
      return;
    }

    // Fastify's own validation errors (route schema rejection) surface as
    // plain Error/FastifyError with a `validation` array, not an ApiError --
    // normalize them to the same INVALID_REQUEST shape instead of leaking
    // ajv's own error format directly.
    const maybeValidation = error as FastifyError & { validation?: readonly { instancePath?: string; message?: string }[] };
    if (Array.isArray(maybeValidation.validation)) {
      reply.status(400).send({
        schemaVersion: '1.0.0',
        error: {
          code: 'INVALID_REQUEST' satisfies ApiErrorCode,
          message: 'request failed schema validation',
          requestId: req.id,
          details: maybeValidation.validation.map((v) => ({ path: v.instancePath, code: v.message ?? 'invalid' })),
        },
      });
      return;
    }

    // Fastify's own request-parsing errors (malformed JSON body, payload
    // over bodyLimit, unsupported content-type) carry a numeric statusCode
    // in the 4xx range but are neither an ApiError nor a `.validation`
    // array -- without this branch they would fall through to a generic
    // 500, mischaracterizing a client mistake as a server failure.
    const maybeHttpError = error as FastifyError & { statusCode?: number };
    if (typeof maybeHttpError.statusCode === 'number' && maybeHttpError.statusCode >= 400 && maybeHttpError.statusCode < 500) {
      const code: ApiErrorCode = maybeHttpError.statusCode === 413 ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST';
      reply.status(maybeHttpError.statusCode).send({
        schemaVersion: '1.0.0',
        error: { code, message: error.message, requestId: req.id },
      });
      return;
    }

    req.log.error({ err: error, requestId: req.id }, 'unhandled error');
    reply.status(500).send({
      schemaVersion: '1.0.0',
      error: {
        code: 'INTERNAL_ERROR' satisfies ApiErrorCode,
        message: 'an unexpected error occurred',
        requestId: req.id,
      },
    });
  });
}
