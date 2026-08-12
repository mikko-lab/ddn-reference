// SPDX-License-Identifier: Apache-2.0
// Milestone 6: AnchorRecordV1 -- what GET /v1/decisions/{id}/anchor returns
// once a receipt's Merkle leaf has been confirmed on-chain. Keyed by
// receiptId (what the leaf actually commits to), never decisionId. Fully
// separate from DecisionReceiptV1, which gains no field for this -- see
// ADR-001/ADR-005: anchoring is decoupled from decision finality.

import type { Sha256Digest } from '@ddn/crypto';
import { ProtocolValidationError } from './protocol-types.js';
import type { MerkleProofV1 } from './merkle.js';

export interface AnchorChainBindingV1 {
  readonly chainId: number;
  readonly contractAddress: string;
}

export interface AnchorConfirmationV1 {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly confirmedAt: string;
}

export interface AnchorRecordV1 {
  readonly schemaVersion: string;
  readonly receiptId: Sha256Digest;
  readonly batchId: Sha256Digest;
  readonly merkleRoot: Sha256Digest;
  readonly proof: MerkleProofV1;
  readonly chain: AnchorChainBindingV1;
  readonly confirmation: AnchorConfirmationV1;
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const ANCHOR_RECORD_FIELDS = ['schemaVersion', 'receiptId', 'batchId', 'merkleRoot', 'proof', 'chain', 'confirmation'] as const;
const PROOF_FIELDS = ['leafHash', 'leafIndex', 'siblings', 'totalLeaves'] as const;
const CHAIN_FIELDS = ['chainId', 'contractAddress'] as const;
const CONFIRMATION_FIELDS = ['txHash', 'blockNumber', 'blockHash', 'confirmedAt'] as const;

function requireNoUnknownFields(obj: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new ProtocolValidationError('UNKNOWN_FIELD', `${label} has an unrecognized field: ${key}`);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolValidationError('INVALID_SHAPE', `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireSha256(obj: Record<string, unknown>, field: string, label: string): Sha256Digest {
  const value = obj[field];
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} must match sha256:<64 lowercase hex>`);
  }
  return value as Sha256Digest;
}

function requireNonNegativeInt(obj: Record<string, unknown>, field: string, label: string): number {
  const value = obj[field];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} must be a non-negative integer`);
  }
  return value as number;
}

function requirePositiveInt(obj: Record<string, unknown>, field: string, label: string): number {
  const value = obj[field];
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} must be a positive integer`);
  }
  return value as number;
}

function requireNonEmptyString(obj: Record<string, unknown>, field: string, label: string): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} must be a non-empty string`);
  }
  return value;
}

function requirePattern(obj: Record<string, unknown>, field: string, pattern: RegExp, label: string): string {
  const value = obj[field];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} does not match the expected format`);
  }
  return value;
}

function parseProof(value: unknown, label: string): MerkleProofV1 {
  const obj = requireObject(value, label);
  requireNoUnknownFields(obj, PROOF_FIELDS, label);
  const leafHash = requireSha256(obj, 'leafHash', label);
  const leafIndex = requireNonNegativeInt(obj, 'leafIndex', label);
  if (!Array.isArray(obj.siblings) || obj.siblings.some((s) => typeof s !== 'string' || !SHA256_PATTERN.test(s))) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.siblings must be an array of sha256 digests`);
  }
  const totalLeaves = requirePositiveInt(obj, 'totalLeaves', label);
  if (leafIndex >= totalLeaves) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.leafIndex must be < totalLeaves`);
  }
  return { leafHash, leafIndex, siblings: obj.siblings as Sha256Digest[], totalLeaves };
}

function parseChain(value: unknown, label: string): AnchorChainBindingV1 {
  const obj = requireObject(value, label);
  requireNoUnknownFields(obj, CHAIN_FIELDS, label);
  return { chainId: requirePositiveInt(obj, 'chainId', label), contractAddress: requirePattern(obj, 'contractAddress', HEX_ADDRESS_PATTERN, label) };
}

function parseConfirmation(value: unknown, label: string): AnchorConfirmationV1 {
  const obj = requireObject(value, label);
  requireNoUnknownFields(obj, CONFIRMATION_FIELDS, label);
  return {
    txHash: requirePattern(obj, 'txHash', HEX_HASH_PATTERN, label),
    blockNumber: requireNonNegativeInt(obj, 'blockNumber', label),
    blockHash: requirePattern(obj, 'blockHash', HEX_HASH_PATTERN, label),
    confirmedAt: requireNonEmptyString(obj, 'confirmedAt', label),
  };
}

/** Parses and validates an AnchorRecordV1, rejecting unknown fields at
 * every nesting level -- mirrors parseDecisionReceiptV1's discipline
 * exactly. Does not itself verify the proof or the receipt it claims to
 * anchor -- call verifyAnchoredDecisionReceipt (anchor-verification.ts)
 * for that. */
export function parseAnchorRecordV1(value: unknown): AnchorRecordV1 {
  const obj = requireObject(value, 'AnchorRecordV1');
  requireNoUnknownFields(obj, ANCHOR_RECORD_FIELDS, 'AnchorRecordV1');
  if (typeof obj.schemaVersion !== 'string' || obj.schemaVersion.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', 'AnchorRecordV1.schemaVersion must be a non-empty string');
  }
  return {
    schemaVersion: obj.schemaVersion,
    receiptId: requireSha256(obj, 'receiptId', 'AnchorRecordV1'),
    batchId: requireSha256(obj, 'batchId', 'AnchorRecordV1'),
    merkleRoot: requireSha256(obj, 'merkleRoot', 'AnchorRecordV1'),
    proof: parseProof(obj.proof, 'AnchorRecordV1.proof'),
    chain: parseChain(obj.chain, 'AnchorRecordV1.chain'),
    confirmation: parseConfirmation(obj.confirmation, 'AnchorRecordV1.confirmation'),
  };
}
