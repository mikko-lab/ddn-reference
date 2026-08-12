// SPDX-License-Identifier: Apache-2.0
// Milestone 4: TypeScript mirrors of the Rust validator protocol types
// (apps/validator/src/protocol.rs, apps/validator/src/identity.rs). Field
// names/shapes must stay byte-for-byte compatible with what
// `ddn-validator execute`/`replay-verify` produce and consume -- this SDK
// verifies Rust-produced signatures without any transformation, so any
// drift here would silently break cross-language compatibility rather
// than fail loudly. See docs/decision-receipt-v1.md.

import type { CanonicalJsonValue } from '@ddn/canonical-json';
import type { Sha256Digest } from '@ddn/crypto';

export const VALIDATOR_RESULT_DOMAIN_V1 = 'DDN_VALIDATOR_RESULT_V1';
export const VALIDATOR_ID_DOMAIN_V1 = 'DDN_VALIDATOR_ID_V1';
export const VALIDATOR_SET_DOMAIN_V1 = 'DDN_VALIDATOR_SET_V1';
export const DECISION_RECEIPT_DOMAIN_V1 = 'DDN_DECISION_RECEIPT_V1';

/** Statuses `ddn-validator` may report for a `ValidatorResultV1`. Anything
 * else is rejected before it can reach quorum -- see isAllowedStatus. */
export const ALLOWED_VALIDATOR_EXECUTION_STATUSES = ['SUCCESS', 'ERROR'] as const;
export type ValidatorExecutionStatus = (typeof ALLOWED_VALIDATOR_EXECUTION_STATUSES)[number];

export interface ExecutionRequestV1 {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyHash: Sha256Digest;
  readonly profileHash: Sha256Digest;
  readonly manifestHash: Sha256Digest;
  readonly input: CanonicalJsonValue;
  readonly inputHash: Sha256Digest;
}

export interface ValidatorResultV1 {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly validatorId: Sha256Digest;
  readonly policyHash: Sha256Digest;
  readonly profileHash: Sha256Digest;
  readonly manifestHash: Sha256Digest;
  readonly inputHash: Sha256Digest;
  readonly output: CanonicalJsonValue;
  readonly outputHash: Sha256Digest;
  readonly executionHash: Sha256Digest;
  readonly status: string;
}

export interface SignedValidatorResultV1 {
  readonly result: ValidatorResultV1;
  readonly validatorPublicKey: string;
  readonly signatureAlgorithm: string;
  readonly signature: string;
}

const EXECUTION_REQUEST_FIELDS = [
  'schemaVersion', 'requestId', 'policyId', 'policyVersion', 'policyHash',
  'profileHash', 'manifestHash', 'input', 'inputHash',
] as const;

const VALIDATOR_RESULT_FIELDS = [
  'schemaVersion', 'requestId', 'validatorId', 'policyHash', 'profileHash',
  'manifestHash', 'inputHash', 'output', 'outputHash', 'executionHash', 'status',
] as const;

const SIGNED_VALIDATOR_RESULT_FIELDS = [
  'result', 'validatorPublicKey', 'signatureAlgorithm', 'signature',
] as const;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ED25519_PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/;
const ED25519_SIGNATURE_PATTERN = /^[0-9a-f]{128}$/;

export class ProtocolValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProtocolValidationError';
    this.code = code;
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolValidationError('INVALID_SHAPE', `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireNoUnknownFields(obj: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ProtocolValidationError('UNKNOWN_FIELD', `${label} has an unrecognized field: ${key}`);
    }
  }
}

function requireString(obj: Record<string, unknown>, field: string, label: string): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} must be a non-empty string`);
  }
  return value;
}

function requireSha256(obj: Record<string, unknown>, field: string, label: string): Sha256Digest {
  const value = requireString(obj, field, label);
  if (!SHA256_PATTERN.test(value)) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} must match sha256:<64 lowercase hex>`);
  }
  return value as Sha256Digest;
}

/** Parses and validates an `ExecutionRequestV1`, rejecting unknown fields --
 * matches the Rust side's `#[serde(deny_unknown_fields)]` on the same type. */
export function parseExecutionRequestV1(value: unknown): ExecutionRequestV1 {
  const obj = requireObject(value, 'ExecutionRequestV1');
  requireNoUnknownFields(obj, EXECUTION_REQUEST_FIELDS, 'ExecutionRequestV1');
  return {
    schemaVersion: requireString(obj, 'schemaVersion', 'ExecutionRequestV1'),
    requestId: requireString(obj, 'requestId', 'ExecutionRequestV1'),
    policyId: requireString(obj, 'policyId', 'ExecutionRequestV1'),
    policyVersion: requireString(obj, 'policyVersion', 'ExecutionRequestV1'),
    policyHash: requireSha256(obj, 'policyHash', 'ExecutionRequestV1'),
    profileHash: requireSha256(obj, 'profileHash', 'ExecutionRequestV1'),
    manifestHash: requireSha256(obj, 'manifestHash', 'ExecutionRequestV1'),
    input: obj.input as CanonicalJsonValue,
    inputHash: requireSha256(obj, 'inputHash', 'ExecutionRequestV1'),
  };
}

/** Parses and validates a `ValidatorResultV1`, rejecting unknown fields. */
export function parseValidatorResultV1(value: unknown): ValidatorResultV1 {
  const obj = requireObject(value, 'ValidatorResultV1');
  requireNoUnknownFields(obj, VALIDATOR_RESULT_FIELDS, 'ValidatorResultV1');
  return {
    schemaVersion: requireString(obj, 'schemaVersion', 'ValidatorResultV1'),
    requestId: requireString(obj, 'requestId', 'ValidatorResultV1'),
    validatorId: requireSha256(obj, 'validatorId', 'ValidatorResultV1'),
    policyHash: requireSha256(obj, 'policyHash', 'ValidatorResultV1'),
    profileHash: requireSha256(obj, 'profileHash', 'ValidatorResultV1'),
    manifestHash: requireSha256(obj, 'manifestHash', 'ValidatorResultV1'),
    inputHash: requireSha256(obj, 'inputHash', 'ValidatorResultV1'),
    output: obj.output as CanonicalJsonValue,
    outputHash: requireSha256(obj, 'outputHash', 'ValidatorResultV1'),
    executionHash: requireSha256(obj, 'executionHash', 'ValidatorResultV1'),
    status: requireString(obj, 'status', 'ValidatorResultV1'),
  };
}

/** Parses and validates a `SignedValidatorResultV1`, rejecting unknown
 * fields at every nesting level. This is the untrusted-input entry point:
 * every `SignedValidatorResultV1` a coordinator collects from a validator
 * process must pass through this before anything else touches it. */
export function parseSignedValidatorResultV1(value: unknown): SignedValidatorResultV1 {
  const obj = requireObject(value, 'SignedValidatorResultV1');
  requireNoUnknownFields(obj, SIGNED_VALIDATOR_RESULT_FIELDS, 'SignedValidatorResultV1');
  const result = parseValidatorResultV1(obj.result);
  const validatorPublicKey = requireString(obj, 'validatorPublicKey', 'SignedValidatorResultV1');
  if (!ED25519_PUBLIC_KEY_PATTERN.test(validatorPublicKey)) {
    throw new ProtocolValidationError('INVALID_FIELD', 'SignedValidatorResultV1.validatorPublicKey must be 64 lowercase hex chars');
  }
  const signatureAlgorithm = requireString(obj, 'signatureAlgorithm', 'SignedValidatorResultV1');
  if (signatureAlgorithm !== 'ed25519') {
    throw new ProtocolValidationError('UNSUPPORTED_ALGORITHM', `unsupported signatureAlgorithm: ${signatureAlgorithm}`);
  }
  const signature = requireString(obj, 'signature', 'SignedValidatorResultV1');
  if (!ED25519_SIGNATURE_PATTERN.test(signature)) {
    throw new ProtocolValidationError('INVALID_FIELD', 'SignedValidatorResultV1.signature must be 128 lowercase hex chars');
  }
  return { result, validatorPublicKey, signatureAlgorithm, signature };
}

export function isAllowedStatus(status: string): status is ValidatorExecutionStatus {
  return (ALLOWED_VALIDATOR_EXECUTION_STATUSES as readonly string[]).includes(status);
}
