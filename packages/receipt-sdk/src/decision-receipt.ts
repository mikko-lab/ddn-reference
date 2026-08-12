// SPDX-License-Identifier: Apache-2.0
// DecisionReceiptV1: the canonical, offline-verifiable artifact a
// coordinator produces once >= threshold distinct trusted validators agree on
// the same ConsensusKeyV1 for one ExecutionRequestV1. See
// docs/decision-receipt-v1.md.
//
// Deliberately excludes any timestamp: useful for a database row, but
// timestamps have a reliable ability to ruin canonical test vectors, and
// nothing about "did these validators agree" depends on when they did.

import { canonicalizeUtf8, type CanonicalJsonValue } from '@ddn/canonical-json';
import { sha256Bytes, type Sha256Digest } from '@ddn/crypto';
import {
  DECISION_RECEIPT_DOMAIN_V1,
  ProtocolValidationError,
  parseExecutionRequestV1,
  parseSignedValidatorResultV1,
  type ExecutionRequestV1,
  type SignedValidatorResultV1,
} from './protocol-types.js';
import {
  consensusKeyOf,
  consensusKeysEqual,
  type ConsensusKeyV1,
  type QuorumSelectionResult,
  type RejectedResultReason,
} from './consensus.js';
import { computeValidatorSetId, type ValidatorSetV1 } from './validator-set.js';
import { validatorIdMatchesPublicKey, verifySignedValidatorResultSignature } from './validator-identity.js';

export interface DecisionReceiptQuorumV1 {
  readonly validatorSetId: Sha256Digest;
  readonly threshold: number;
  readonly totalValidators: number;
  /** Sorted ascending -- part of the receipt's deterministic-ordering guarantee. */
  readonly agreeingValidatorIds: readonly string[];
}

export interface DecisionReceiptV1 {
  readonly schemaVersion: string;
  readonly receiptId: Sha256Digest;
  readonly request: ExecutionRequestV1;
  readonly quorum: DecisionReceiptQuorumV1;
  readonly consensus: ConsensusKeyV1;
  /** Sorted ascending by `result.validatorId` -- same ordering guarantee. */
  readonly signedResults: readonly SignedValidatorResultV1[];
}

/** Everything `receiptId` is computed over -- everything in
 * `DecisionReceiptV1` except `receiptId` itself. */
export type DecisionReceiptContentV1 = Omit<DecisionReceiptV1, 'receiptId'>;

function sortedByValidatorId(results: readonly SignedValidatorResultV1[]): SignedValidatorResultV1[] {
  return [...results].sort((a, b) => a.result.validatorId.localeCompare(b.result.validatorId));
}

/**
 * `receiptId = sha256(canonicalize({ domain: "DDN_DECISION_RECEIPT_V1",
 * request, quorum, consensus, signedResults }))` -- a flat envelope (domain
 * alongside the other top-level fields), matching `deriveValidatorId`'s
 * convention rather than `hashCanonicalJson`'s `{ domain, value }` wrapper.
 * `signedResults` and `quorum.agreeingValidatorIds` are sorted before
 * hashing regardless of the order they arrive in, so the receipt's
 * canonical form (and therefore its id) never depends on validator
 * response order.
 */
export function computeReceiptId(content: DecisionReceiptContentV1): Sha256Digest {
  const envelope: CanonicalJsonValue = {
    domain: DECISION_RECEIPT_DOMAIN_V1,
    request: content.request as unknown as CanonicalJsonValue,
    quorum: {
      validatorSetId: content.quorum.validatorSetId,
      threshold: content.quorum.threshold,
      totalValidators: content.quorum.totalValidators,
      agreeingValidatorIds: [...content.quorum.agreeingValidatorIds].sort(),
    },
    consensus: content.consensus as unknown as CanonicalJsonValue,
    signedResults: sortedByValidatorId(content.signedResults) as unknown as CanonicalJsonValue,
  };
  return sha256Bytes(canonicalizeUtf8(envelope));
}

/** Builds a `DecisionReceiptV1` from a `QUORUM_REACHED` selection --
 * throws if quorum was not actually reached, rather than silently
 * producing a receipt for a decision that was never agreed on. */
export function buildDecisionReceipt(
  request: ExecutionRequestV1,
  validatorSet: ValidatorSetV1,
  quorum: QuorumSelectionResult,
): DecisionReceiptV1 {
  if (quorum.outcome !== 'QUORUM_REACHED' || quorum.consensusKey === null) {
    throw new ProtocolValidationError('NO_QUORUM', 'cannot build a DecisionReceiptV1 without a reached quorum');
  }
  const content: DecisionReceiptContentV1 = {
    schemaVersion: '1.0.0',
    request,
    quorum: {
      validatorSetId: validatorSet.validatorSetId,
      threshold: validatorSet.threshold,
      totalValidators: validatorSet.validators.length,
      agreeingValidatorIds: [...quorum.agreeingValidatorIds].sort(),
    },
    consensus: quorum.consensusKey,
    signedResults: sortedByValidatorId(quorum.agreeingResults),
  };
  return { ...content, receiptId: computeReceiptId(content) };
}

/** What a coordinator emits instead of a receipt when quorum was not
 * reached -- diagnostic, never a substitute proof of agreement. */
export interface CoordinatorFailureV1 {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly reason: 'NO_QUORUM' | 'EXECUTION_HASH_COLLISION';
  readonly groups: ReadonlyArray<{ readonly key: ConsensusKeyV1; readonly validatorIds: readonly string[] }>;
  readonly rejected: ReadonlyArray<{ readonly validatorId: string; readonly reason: RejectedResultReason }>;
}

export function buildCoordinatorFailure(request: ExecutionRequestV1, quorum: QuorumSelectionResult): CoordinatorFailureV1 {
  if (quorum.outcome === 'QUORUM_REACHED') {
    throw new ProtocolValidationError('QUORUM_REACHED', 'cannot build a CoordinatorFailureV1 when quorum was reached');
  }
  return {
    schemaVersion: '1.0.0',
    requestId: request.requestId,
    reason: quorum.outcome,
    groups: quorum.groups.map((g) => ({ key: g.key, validatorIds: g.members.map((m) => m.result.validatorId).sort() })),
    rejected: quorum.rejected.map((r) => ({ validatorId: r.signed.result.validatorId, reason: r.reason })),
  };
}

const DECISION_RECEIPT_FIELDS = ['schemaVersion', 'receiptId', 'request', 'quorum', 'consensus', 'signedResults'] as const;
const QUORUM_FIELDS = ['validatorSetId', 'threshold', 'totalValidators', 'agreeingValidatorIds'] as const;
const CONSENSUS_FIELDS = ['policyHash', 'profileHash', 'inputHash', 'outputHash', 'executionHash', 'status'] as const;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function requireNoUnknownFields(obj: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new ProtocolValidationError('UNKNOWN_FIELD', `${label} has an unrecognized field: ${key}`);
  }
}

function requireSha256(obj: Record<string, unknown>, field: string, label: string): Sha256Digest {
  const value = obj[field];
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.${field} must match sha256:<64 lowercase hex>`);
  }
  return value as Sha256Digest;
}

function parseConsensusKeyV1(value: unknown, label: string): ConsensusKeyV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolValidationError('INVALID_SHAPE', `${label} must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  requireNoUnknownFields(obj, CONSENSUS_FIELDS, label);
  if (typeof obj.status !== 'string' || obj.status.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', `${label}.status must be a non-empty string`);
  }
  return {
    policyHash: requireSha256(obj, 'policyHash', label),
    profileHash: requireSha256(obj, 'profileHash', label),
    inputHash: requireSha256(obj, 'inputHash', label),
    outputHash: requireSha256(obj, 'outputHash', label),
    executionHash: requireSha256(obj, 'executionHash', label),
    status: obj.status,
  };
}

/** Parses and validates a `DecisionReceiptV1`, rejecting unknown fields at
 * every nesting level. Does not check `receiptId`, signatures, or the
 * validator set against this -- call `verifyDecisionReceipt` for the full
 * offline check. */
export function parseDecisionReceiptV1(value: unknown): DecisionReceiptV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolValidationError('INVALID_SHAPE', 'DecisionReceiptV1 must be a JSON object');
  }
  const obj = value as Record<string, unknown>;
  requireNoUnknownFields(obj, DECISION_RECEIPT_FIELDS, 'DecisionReceiptV1');
  if (typeof obj.schemaVersion !== 'string' || obj.schemaVersion.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', 'DecisionReceiptV1.schemaVersion must be a non-empty string');
  }
  const receiptId = requireSha256(obj, 'receiptId', 'DecisionReceiptV1');
  const request = parseExecutionRequestV1(obj.request);

  if (typeof obj.quorum !== 'object' || obj.quorum === null || Array.isArray(obj.quorum)) {
    throw new ProtocolValidationError('INVALID_SHAPE', 'DecisionReceiptV1.quorum must be a JSON object');
  }
  const quorumObj = obj.quorum as Record<string, unknown>;
  requireNoUnknownFields(quorumObj, QUORUM_FIELDS, 'DecisionReceiptV1.quorum');
  if (!Number.isInteger(quorumObj.threshold) || (quorumObj.threshold as number) < 1) {
    throw new ProtocolValidationError('INVALID_FIELD', 'DecisionReceiptV1.quorum.threshold must be a positive integer');
  }
  if (!Number.isInteger(quorumObj.totalValidators) || (quorumObj.totalValidators as number) < 1) {
    throw new ProtocolValidationError('INVALID_FIELD', 'DecisionReceiptV1.quorum.totalValidators must be a positive integer');
  }
  if (!Array.isArray(quorumObj.agreeingValidatorIds) || quorumObj.agreeingValidatorIds.some((id) => typeof id !== 'string')) {
    throw new ProtocolValidationError('INVALID_FIELD', 'DecisionReceiptV1.quorum.agreeingValidatorIds must be an array of strings');
  }
  const quorum: DecisionReceiptQuorumV1 = {
    validatorSetId: requireSha256(quorumObj, 'validatorSetId', 'DecisionReceiptV1.quorum'),
    threshold: quorumObj.threshold as number,
    totalValidators: quorumObj.totalValidators as number,
    agreeingValidatorIds: quorumObj.agreeingValidatorIds as string[],
  };

  const consensus = parseConsensusKeyV1(obj.consensus, 'DecisionReceiptV1.consensus');

  if (!Array.isArray(obj.signedResults) || obj.signedResults.length === 0) {
    throw new ProtocolValidationError('INVALID_FIELD', 'DecisionReceiptV1.signedResults must be a non-empty array');
  }
  const signedResults = obj.signedResults.map((r) => parseSignedValidatorResultV1(r));

  return { schemaVersion: obj.schemaVersion, receiptId, request, quorum, consensus, signedResults };
}

export interface ReceiptVerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface ReceiptVerificationResult {
  readonly ok: boolean;
  readonly checks: readonly ReceiptVerificationCheck[];
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Full offline verification of a `DecisionReceiptV1` against a trusted
 * `ValidatorSetV1` -- schema, the validator set's own integrity, every
 * contributing validator's identity/signature/request-binding, absence of
 * duplicate validators, agreement on one `ConsensusKeyV1`, the quorum
 * threshold actually being met, deterministic ordering, and `receiptId`
 * itself. Every check runs (not short-circuited on the first failure) so a
 * caller sees the full picture; `ok` is `true` only if every one passed.
 *
 * Does NOT re-run `policy.wasm` -- that's `ddn-validator replay-verify`'s
 * job (Milestone 3). A later, combined command can chain "verify receipt
 * -> replay one or all contributing results"; keeping them separate here on
 * purpose so this stays a pure, dependency-light library rather than
 * growing a WASM runtime and a process-management layer of its own.
 */
export function verifyDecisionReceipt(receipt: unknown, validatorSet: ValidatorSetV1): ReceiptVerificationResult {
  const checks: ReceiptVerificationCheck[] = [];
  const push = (name: string, passed: boolean, detail?: string) =>
    checks.push(detail === undefined ? { name, passed } : { name, passed, detail });

  let parsed: DecisionReceiptV1;
  try {
    parsed = parseDecisionReceiptV1(receipt);
    push('schemaValid', true);
  } catch (error) {
    push('schemaValid', false, error instanceof Error ? error.message : String(error));
    return { ok: false, checks };
  }

  const recomputedSetId = computeValidatorSetId(validatorSet);
  push('validatorSetIdMatchesItsOwnContent', recomputedSetId === validatorSet.validatorSetId);
  push('receiptValidatorSetIdMatchesGivenSet', parsed.quorum.validatorSetId === validatorSet.validatorSetId);
  push('receiptThresholdMatchesValidatorSet', parsed.quorum.threshold === validatorSet.threshold);
  push('receiptTotalValidatorsMatchesSet', parsed.quorum.totalValidators === validatorSet.validators.length);

  const sortedIds = [...parsed.quorum.agreeingValidatorIds].sort();
  push('agreeingValidatorIdsAreSorted', arraysEqual(parsed.quorum.agreeingValidatorIds, sortedIds));
  const sortedResults = sortedByValidatorId(parsed.signedResults);
  push(
    'signedResultsAreSortedByValidatorId',
    parsed.signedResults.every((s, i) => s.result.validatorId === sortedResults[i]?.result.validatorId),
  );

  let allIdentitiesOk = true;
  let allSignaturesOk = true;
  let allRequestBindingsOk = true;
  let allKnownValidators = true;
  let noDuplicates = true;
  let allShareConsensus = true;
  const seen = new Set<string>();
  for (const signed of parsed.signedResults) {
    if (!validatorIdMatchesPublicKey(signed)) allIdentitiesOk = false;
    if (!verifySignedValidatorResultSignature(signed)) allSignaturesOk = false;
    if (
      signed.result.requestId !== parsed.request.requestId ||
      signed.result.policyHash !== parsed.request.policyHash ||
      signed.result.profileHash !== parsed.request.profileHash ||
      signed.result.inputHash !== parsed.request.inputHash
    ) {
      allRequestBindingsOk = false;
    }
    if (!validatorSet.validators.some((m) => m.validatorId === signed.result.validatorId)) allKnownValidators = false;
    if (seen.has(signed.result.validatorId)) noDuplicates = false;
    seen.add(signed.result.validatorId);
    if (!consensusKeysEqual(consensusKeyOf(signed.result), parsed.consensus)) allShareConsensus = false;
  }
  push('everyContributingValidatorIdMatchesPublicKey', allIdentitiesOk);
  push('everyContributingSignatureValid', allSignaturesOk);
  push('everyContributingResultBoundToRequest', allRequestBindingsOk);
  push('everyContributingValidatorInSet', allKnownValidators);
  push('noDuplicateContributingValidatorIds', noDuplicates);
  push('allSignedResultsShareReceiptConsensus', allShareConsensus);

  const resultIds = new Set<string>(parsed.signedResults.map((s) => s.result.validatorId));
  const agreeingIdsMatchResults =
    parsed.quorum.agreeingValidatorIds.length === resultIds.size &&
    parsed.quorum.agreeingValidatorIds.every((id) => resultIds.has(id));
  push('agreeingValidatorIdsMatchSignedResults', agreeingIdsMatchResults);

  push('quorumThresholdReached', parsed.signedResults.length >= parsed.quorum.threshold);

  const { receiptId, ...content } = parsed;
  const recomputedReceiptId = computeReceiptId(content);
  push('receiptIdMatchesContent', recomputedReceiptId === receiptId);

  return { ok: checks.every((c) => c.passed), checks };
}
