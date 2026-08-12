// SPDX-License-Identifier: Apache-2.0
// @ddn/schemas
//
// NegotiationInputV1 / NegotiationOutputV1 types, the closed reason-code
// registry, and runtime validation. JSON Schema (packages/schemas/json/*)
// is the single source of truth for structural/type constraints; the
// TypeScript interfaces below are kept in sync with it by hand. Ajv
// validates directly against the schema file, so "JSON Schema" and
// "runtime validation" can never quietly diverge on structural rules.
//
// Cross-field invariants (e.g. floorPriceCents <= listPriceCents) are not
// expressible in portable JSON Schema without non-standard extensions, so
// they are checked separately, after schema validation succeeds. See
// docs/negotiation-policy-v1.md.

import { Ajv, type ValidateFunction } from 'ajv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type NegotiationDecision = 'ACCEPT' | 'COUNTER' | 'REJECT' | 'ESCALATE';

/** Closed v1 reason-code registry. No free-form reason codes are permitted. */
export const NEGOTIATION_REASON_CODES_V1 = [
  'OFFER_AT_OR_ABOVE_LIST',
  'OFFER_AT_OR_ABOVE_FLOOR',
  'OFFER_BELOW_FLOOR',
  'FINAL_COUNTER_AVAILABLE',
  'OFFER_LIMIT_REACHED',
  'CONDITION_REPORT_NOT_ACKNOWLEDGED',
  'INVALID_PRICE_RELATION',
  'POLICY_NOT_EFFECTIVE',
  'HUMAN_REVIEW_REQUIRED',
] as const;

export type NegotiationReasonCode = (typeof NEGOTIATION_REASON_CODES_V1)[number];

export interface NegotiationInputV1 {
  readonly schemaVersion: '1.0.0';
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly sessionId: string;
  readonly listPriceCents: number;
  readonly floorPriceCents: number;
  readonly customerOfferCents: number;
  readonly offerNumber: number;
  readonly maxOffers: number;
  readonly conditionReportAcknowledged: boolean;
  readonly policyEffectiveAt: string;
}

export interface NegotiationOutputV1 {
  readonly schemaVersion: '1.0.0';
  readonly decision: NegotiationDecision;
  readonly counterOfferCents: number | null;
  readonly reasonCodes: readonly NegotiationReasonCode[];
  readonly humanReviewRequired: boolean;
}

export type SchemaValidationErrorCode =
  | 'SCHEMA_VALIDATION_FAILED'
  | 'INVALID_PRICE_RELATION'
  | 'INVALID_OFFER_RELATION'
  | 'INVALID_COUNTER_OFFER'
  | 'DUPLICATE_REASON_CODE'
  | 'INVALID_HUMAN_REVIEW_FLAG';

export class SchemaValidationError extends Error {
  readonly code: SchemaValidationErrorCode;
  readonly details?: unknown;

  constructor(code: SchemaValidationErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'SchemaValidationError';
    this.code = code;
    this.details = details;
  }
}

// Deliberately NOT `new URL(`../json/${filename}`, import.meta.url)`, and
// NOT `new URL('../json/', import.meta.url)` either. Bundlers (observed
// with Next.js/Turbopack, apps/demo-negotiation-reference's offer route) specifically
// special-case the two-argument `new URL(request, import.meta.url)` form
// to trace and copy referenced assets at build time; with a template
// literal it was observed to silently resolve to a COMPLETELY DIFFERENT
// file under json/ at runtime (negotiation-input-v1.schema.json's reader
// returned api-error-response.schema.json's contents), and with a bare
// directory literal it fails the build outright ("Module not found").
// Using the single-argument `fileURLToPath(import.meta.url)` plus plain
// node:path math avoids the two-argument form entirely, so there is
// nothing for that bundler heuristic to (mis)trace.
const JSON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'json');

function readJsonSchema(filename: string): object {
  return JSON.parse(readFileSync(join(JSON_DIR, filename), 'utf8'));
}

const ajv = new Ajv({ allErrors: true, strict: true });

const negotiationInputSchema = readJsonSchema('negotiation-input-v1.schema.json');
const negotiationOutputSchema = readJsonSchema('negotiation-output-v1.schema.json');

// Compiles WITHOUT ever registering the schema under its own $id in this
// ajv instance's internal registry -- see api-v1.ts's own compileOnce for
// the full story. An earlier version tried to dedupe a double-compile of
// the same $id (observed with Next.js/Turbopack's route "collect
// configuration" step re-evaluating this module's top-level code) by
// reusing whatever ajv.getSchema(id) returned; that masked the crash but
// occasionally returned a validator compiled for a COMPLETELY DIFFERENT
// schema sharing the same $id string across what should have been
// separate ajv instances/module realms -- silently validating against
// the wrong schema is far worse than a loud crash. Stripping $id before
// compiling means there is no id-keyed registry entry for anything to
// collide with or accidentally reuse, in any realm.
function compileOnce(schema: { readonly $id?: string }): ValidateFunction {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $id, ...schemaWithoutId } = schema as Record<string, unknown>;
  return ajv.compile(schemaWithoutId);
}

const validateInputSchema: ValidateFunction = compileOnce(negotiationInputSchema);
const validateOutputSchema: ValidateFunction = compileOnce(negotiationOutputSchema);

export function validateNegotiationInputV1(value: unknown): asserts value is NegotiationInputV1 {
  if (!validateInputSchema(value)) {
    throw new SchemaValidationError(
      'SCHEMA_VALIDATION_FAILED',
      'value does not conform to negotiation-input-v1.schema.json',
      validateInputSchema.errors
    );
  }
  const input = value as NegotiationInputV1;
  if (input.floorPriceCents > input.listPriceCents) {
    throw new SchemaValidationError('INVALID_PRICE_RELATION', 'floorPriceCents must be <= listPriceCents');
  }
  if (input.offerNumber > input.maxOffers) {
    throw new SchemaValidationError('INVALID_OFFER_RELATION', 'offerNumber must be <= maxOffers');
  }
}

export function validateNegotiationOutputV1(value: unknown): asserts value is NegotiationOutputV1 {
  if (!validateOutputSchema(value)) {
    throw new SchemaValidationError(
      'SCHEMA_VALIDATION_FAILED',
      'value does not conform to negotiation-output-v1.schema.json',
      validateOutputSchema.errors
    );
  }
  const output = value as NegotiationOutputV1;

  if ((output.decision === 'ACCEPT' || output.decision === 'REJECT') && output.counterOfferCents !== null) {
    throw new SchemaValidationError(
      'INVALID_COUNTER_OFFER',
      `${output.decision} must have counterOfferCents === null`
    );
  }
  if (output.decision === 'COUNTER' && output.counterOfferCents === null) {
    throw new SchemaValidationError('INVALID_COUNTER_OFFER', 'COUNTER must have a non-null counterOfferCents');
  }
  if (output.decision === 'ESCALATE' && !output.humanReviewRequired) {
    throw new SchemaValidationError('INVALID_HUMAN_REVIEW_FLAG', 'ESCALATE must have humanReviewRequired === true');
  }
  const seen = new Set<string>();
  for (const code of output.reasonCodes) {
    if (seen.has(code)) {
      throw new SchemaValidationError('DUPLICATE_REASON_CODE', `duplicate reason code: ${code}`);
    }
    seen.add(code);
  }
}

export * from './api-v1.js';
