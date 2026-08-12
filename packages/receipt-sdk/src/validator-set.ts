// SPDX-License-Identifier: Apache-2.0
// The set of validators a coordinator is willing to count toward quorum.
// `validatorSetId` is always derived from the set's own content, the same
// way `validatorId` is always derived from a public key (see
// validator-identity.ts) -- never freely supplied as configuration text.
// See docs/decision-receipt-v1.md.

import { canonicalizeUtf8, type CanonicalJsonValue } from '@ddn/canonical-json';
import { sha256Bytes, type Sha256Digest } from '@ddn/crypto';
import { VALIDATOR_SET_DOMAIN_V1 } from './protocol-types.js';
import { deriveValidatorId } from './validator-identity.js';
import { ProtocolValidationError } from './protocol-types.js';

export interface ValidatorSetMemberV1 {
  readonly validatorId: Sha256Digest;
  readonly publicKey: string;
  readonly signatureAlgorithm: 'ed25519';
}

export interface ValidatorSetV1 {
  readonly schemaVersion: string;
  readonly validatorSetId: Sha256Digest;
  readonly threshold: number;
  readonly validators: readonly ValidatorSetMemberV1[];
}

/** The content a validator set's id is computed over -- everything in
 * `ValidatorSetV1` except `validatorSetId` itself (computing a hash that
 * includes its own value would be circular). */
export type ValidatorSetContentV1 = Omit<ValidatorSetV1, 'validatorSetId'>;

function sortedMembers(members: readonly ValidatorSetMemberV1[]): ValidatorSetMemberV1[] {
  return [...members].sort((a, b) => a.validatorId.localeCompare(b.validatorId));
}

/** Builds a fresh `ValidatorSetV1` from its public keys, deriving both
 * every member's `validatorId` and the set's own `validatorSetId` --
 * nothing here is caller-supplied identity, only public keys and the
 * threshold. Members are stored sorted by `validatorId` so the set's
 * canonical form (and therefore its id) never depends on the order public
 * keys happened to be passed in. */
export function buildValidatorSetV1(input: {
  readonly schemaVersion: string;
  readonly threshold: number;
  readonly publicKeys: readonly string[];
}): ValidatorSetV1 {
  const members = sortedMembers(
    input.publicKeys.map((publicKey) => ({
      validatorId: deriveValidatorId(publicKey),
      publicKey,
      signatureAlgorithm: 'ed25519' as const,
    })),
  );
  const content: ValidatorSetContentV1 = { schemaVersion: input.schemaVersion, threshold: input.threshold, validators: members };
  return { ...content, validatorSetId: computeValidatorSetIdFromContent(content) };
}

function computeValidatorSetIdFromContent(content: ValidatorSetContentV1): Sha256Digest {
  const envelope: CanonicalJsonValue = {
    domain: VALIDATOR_SET_DOMAIN_V1,
    schemaVersion: content.schemaVersion,
    threshold: content.threshold,
    validators: sortedMembers(content.validators) as unknown as CanonicalJsonValue,
  };
  return sha256Bytes(canonicalizeUtf8(envelope));
}

/** Independently recomputes what `validatorSet.validatorSetId` should be
 * from its own content (ignoring whatever value the field itself already
 * holds) -- the same "never trust a self-declared hash" pattern as
 * `manifestHash`/`policyHash` in the Rust validator. Used to verify a
 * `ValidatorSetV1` a coordinator loaded from disk actually matches its own
 * claimed id. */
export function computeValidatorSetId(validatorSet: ValidatorSetV1): Sha256Digest {
  return computeValidatorSetIdFromContent({
    schemaVersion: validatorSet.schemaVersion,
    threshold: validatorSet.threshold,
    validators: validatorSet.validators,
  });
}

const VALIDATOR_SET_FIELDS = ['schemaVersion', 'validatorSetId', 'threshold', 'validators'] as const;
const VALIDATOR_SET_MEMBER_FIELDS = ['validatorId', 'publicKey', 'signatureAlgorithm'] as const;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ED25519_PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/;

/** Parses and validates a `ValidatorSetV1`, rejecting unknown fields at
 * every level. Does NOT check that `validatorSetId` matches its own
 * content -- call `computeValidatorSetId` separately for that, so a
 * caller can distinguish "malformed" from "tampered". */
export function parseValidatorSetV1(value: unknown): ValidatorSetV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolValidationError('INVALID_SHAPE', 'ValidatorSetV1 must be a JSON object');
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(VALIDATOR_SET_FIELDS as readonly string[]).includes(key)) {
      throw new ProtocolValidationError('UNKNOWN_FIELD', `ValidatorSetV1 has an unrecognized field: ${key}`);
    }
  }
  if (typeof obj.schemaVersion !== 'string' || obj.schemaVersion.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', 'ValidatorSetV1.schemaVersion must be a non-empty string');
  }
  if (typeof obj.validatorSetId !== 'string' || !SHA256_PATTERN.test(obj.validatorSetId)) {
    throw new ProtocolValidationError('INVALID_FIELD', 'ValidatorSetV1.validatorSetId must match sha256:<64 lowercase hex>');
  }
  if (!Number.isInteger(obj.threshold) || (obj.threshold as number) < 1) {
    throw new ProtocolValidationError('INVALID_FIELD', 'ValidatorSetV1.threshold must be a positive integer');
  }
  if (!Array.isArray(obj.validators) || obj.validators.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', 'ValidatorSetV1.validators must be a non-empty array');
  }
  const validators = obj.validators.map((member, index) => parseValidatorSetMemberV1(member, index));
  return {
    schemaVersion: obj.schemaVersion,
    validatorSetId: obj.validatorSetId as Sha256Digest,
    threshold: obj.threshold as number,
    validators,
  };
}

function parseValidatorSetMemberV1(value: unknown, index: number): ValidatorSetMemberV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolValidationError('INVALID_SHAPE', `ValidatorSetV1.validators[${index}] must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(VALIDATOR_SET_MEMBER_FIELDS as readonly string[]).includes(key)) {
      throw new ProtocolValidationError('UNKNOWN_FIELD', `ValidatorSetV1.validators[${index}] has an unrecognized field: ${key}`);
    }
  }
  if (typeof obj.validatorId !== 'string' || !SHA256_PATTERN.test(obj.validatorId)) {
    throw new ProtocolValidationError('INVALID_FIELD', `ValidatorSetV1.validators[${index}].validatorId must match sha256:<64 lowercase hex>`);
  }
  if (typeof obj.publicKey !== 'string' || !ED25519_PUBLIC_KEY_PATTERN.test(obj.publicKey)) {
    throw new ProtocolValidationError('INVALID_FIELD', `ValidatorSetV1.validators[${index}].publicKey must be 64 lowercase hex chars`);
  }
  if (obj.signatureAlgorithm !== 'ed25519') {
    throw new ProtocolValidationError('UNSUPPORTED_ALGORITHM', `ValidatorSetV1.validators[${index}].signatureAlgorithm must be ed25519`);
  }
  return { validatorId: obj.validatorId as Sha256Digest, publicKey: obj.publicKey, signatureAlgorithm: 'ed25519' };
}
