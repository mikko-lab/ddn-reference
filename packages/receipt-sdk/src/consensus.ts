// SPDX-License-Identifier: Apache-2.0
// Grouping and quorum selection over a set of SignedValidatorResultV1s for
// one ExecutionRequestV1. Every check here runs before a result may count
// toward quorum -- an invalid/unknown/duplicate result is excluded, never
// silently promoted. See docs/decision-receipt-v1.md.

import type { Sha256Digest } from '@ddn/crypto';
import { isAllowedStatus, type ExecutionRequestV1, type SignedValidatorResultV1, type ValidatorResultV1 } from './protocol-types.js';
import { validatorIdMatchesPublicKey, verifySignedValidatorResultSignature } from './validator-identity.js';
import type { ValidatorSetV1 } from './validator-set.js';

/** The full binding a group of validator results must agree on to count as
 * one consensus outcome -- deliberately more than just `executionHash`: if
 * a correctly-implemented hash ever collided, or a validator lied about a
 * component hash while still landing on the same executionHash by chance,
 * this catches it instead of trusting executionHash equality alone. */
export interface ConsensusKeyV1 {
  readonly policyHash: Sha256Digest;
  readonly profileHash: Sha256Digest;
  readonly inputHash: Sha256Digest;
  readonly outputHash: Sha256Digest;
  readonly executionHash: Sha256Digest;
  readonly status: string;
}

export interface ConsensusGroup {
  readonly key: ConsensusKeyV1;
  readonly members: readonly SignedValidatorResultV1[];
}

export function consensusKeyOf(result: ValidatorResultV1): ConsensusKeyV1 {
  return {
    policyHash: result.policyHash,
    profileHash: result.profileHash,
    inputHash: result.inputHash,
    outputHash: result.outputHash,
    executionHash: result.executionHash,
    status: result.status,
  };
}

export function consensusKeysEqual(a: ConsensusKeyV1, b: ConsensusKeyV1): boolean {
  return (
    a.policyHash === b.policyHash &&
    a.profileHash === b.profileHash &&
    a.inputHash === b.inputHash &&
    a.outputHash === b.outputHash &&
    a.executionHash === b.executionHash &&
    a.status === b.status
  );
}

function consensusKeyString(key: ConsensusKeyV1): string {
  // Every field is either a sha256:<hex> digest or a status string drawn
  // from a fixed allowlist -- none can contain the separator, so a plain
  // join is a safe, unambiguous key (no canonicalization needed for an
  // internal Map key, unlike anything that gets hashed/signed).
  return [key.policyHash, key.profileHash, key.inputHash, key.outputHash, key.executionHash, key.status].join('|');
}

/** Groups results by their full `ConsensusKeyV1`. Does not verify anything
 * about the results themselves -- callers should only pass results that
 * already passed `validateForQuorum`. */
export function groupValidatorResults(results: readonly SignedValidatorResultV1[]): ConsensusGroup[] {
  const byKey = new Map<string, ConsensusGroup>();
  for (const signed of results) {
    const key = consensusKeyOf(signed.result);
    const keyStr = consensusKeyString(key);
    const existing = byKey.get(keyStr);
    if (existing) {
      (existing.members as SignedValidatorResultV1[]).push(signed);
    } else {
      byKey.set(keyStr, { key, members: [signed] });
    }
  }
  return [...byKey.values()];
}

/** Detects the "same executionHash, different other bindings" integrity
 * violation explicitly called out in docs/decision-receipt-v1.md: this
 * should be impossible with a correctly-implemented hash, but the
 * coordinator must never assume that rather than check it. Returns the
 * offending executionHash if found. */
export function findExecutionHashCollisionWithDivergentKey(groups: readonly ConsensusGroup[]): Sha256Digest | null {
  const byExecutionHash = new Map<Sha256Digest, ConsensusKeyV1>();
  for (const group of groups) {
    const prior = byExecutionHash.get(group.key.executionHash);
    if (prior && consensusKeyString(prior) !== consensusKeyString(group.key)) {
      return group.key.executionHash;
    }
    byExecutionHash.set(group.key.executionHash, group.key);
  }
  return null;
}

export type RejectedResultReason =
  | 'PARSE_ERROR'
  | 'INVALID_SIGNATURE'
  | 'VALIDATOR_ID_MISMATCH'
  | 'REQUEST_ID_MISMATCH'
  | 'POLICY_HASH_MISMATCH'
  | 'PROFILE_HASH_MISMATCH'
  | 'INPUT_HASH_MISMATCH'
  | 'UNKNOWN_VALIDATOR'
  | 'DUPLICATE_VALIDATOR_ID'
  | 'RESULT_TOO_LARGE'
  | 'DISALLOWED_STATUS';

export interface RejectedResult {
  readonly signed: SignedValidatorResultV1;
  readonly reason: RejectedResultReason;
}

const DEFAULT_MAX_RESULT_BYTES = 1_000_000;

/** Runs the full pre-quorum checklist (docs/decision-receipt-v1.md) over
 * one already-schema-valid `SignedValidatorResultV1`, independent of every
 * other result -- duplicate detection across the whole batch happens
 * separately in `validateForQuorum`, since it can't be decided from one
 * result alone. */
function checkSingleResult(
  signed: SignedValidatorResultV1,
  request: ExecutionRequestV1,
  validatorSet: ValidatorSetV1,
  maxResultBytes: number,
): RejectedResultReason | null {
  if (!isAllowedStatus(signed.result.status)) return 'DISALLOWED_STATUS';
  if (JSON.stringify(signed).length > maxResultBytes) return 'RESULT_TOO_LARGE';
  if (!validatorIdMatchesPublicKey(signed)) return 'VALIDATOR_ID_MISMATCH';
  if (!verifySignedValidatorResultSignature(signed)) return 'INVALID_SIGNATURE';
  if (signed.result.requestId !== request.requestId) return 'REQUEST_ID_MISMATCH';
  if (signed.result.policyHash !== request.policyHash) return 'POLICY_HASH_MISMATCH';
  if (signed.result.profileHash !== request.profileHash) return 'PROFILE_HASH_MISMATCH';
  if (signed.result.inputHash !== request.inputHash) return 'INPUT_HASH_MISMATCH';
  const isKnownValidator = validatorSet.validators.some((member) => member.validatorId === signed.result.validatorId);
  if (!isKnownValidator) return 'UNKNOWN_VALIDATOR';
  return null;
}

export interface QuorumValidationResult {
  readonly accepted: readonly SignedValidatorResultV1[];
  readonly rejected: readonly RejectedResult[];
}

/**
 * The full pre-quorum checklist from docs/decision-receipt-v1.md, applied
 * to every candidate result: schema validity is assumed already checked by
 * the caller (`parseSignedValidatorResultV1`); this checks identity,
 * signature, request-binding, validator-set membership, size, allowed
 * status, and -- across the whole batch, not per-result -- duplicate
 * `validatorId`s. A validatorId appearing more than once excludes *every*
 * occurrence (not "keep the first") and is tagged `DUPLICATE_VALIDATOR_ID`
 * distinctly from a plain signature/identity failure: three copies of the
 * same signature must never be countable as three votes.
 */
export function validateForQuorum(
  results: readonly SignedValidatorResultV1[],
  request: ExecutionRequestV1,
  validatorSet: ValidatorSetV1,
  options?: { readonly maxResultBytes?: number },
): QuorumValidationResult {
  const maxResultBytes = options?.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  const rejected: RejectedResult[] = [];
  const provisionallyAccepted: SignedValidatorResultV1[] = [];

  for (const signed of results) {
    const reason = checkSingleResult(signed, request, validatorSet, maxResultBytes);
    if (reason) {
      rejected.push({ signed, reason });
    } else {
      provisionallyAccepted.push(signed);
    }
  }

  const countByValidatorId = new Map<string, number>();
  for (const signed of provisionallyAccepted) {
    countByValidatorId.set(signed.result.validatorId, (countByValidatorId.get(signed.result.validatorId) ?? 0) + 1);
  }

  const accepted: SignedValidatorResultV1[] = [];
  for (const signed of provisionallyAccepted) {
    if ((countByValidatorId.get(signed.result.validatorId) ?? 0) > 1) {
      rejected.push({ signed, reason: 'DUPLICATE_VALIDATOR_ID' });
    } else {
      accepted.push(signed);
    }
  }

  return { accepted, rejected };
}

export type QuorumOutcome = 'QUORUM_REACHED' | 'NO_QUORUM' | 'EXECUTION_HASH_COLLISION';

export interface QuorumSelectionResult {
  readonly outcome: QuorumOutcome;
  readonly consensusKey: ConsensusKeyV1 | null;
  /** Sorted ascending -- the receipt's deterministic ordering requirement. */
  readonly agreeingValidatorIds: readonly string[];
  /** Sorted ascending by `result.validatorId` -- same ordering guarantee. */
  readonly agreeingResults: readonly SignedValidatorResultV1[];
  readonly rejected: readonly RejectedResult[];
  readonly groups: readonly ConsensusGroup[];
}

/**
 * Runs the full pre-quorum checklist, groups the survivors by
 * `ConsensusKeyV1`, and selects the group that reaches `validatorSet.threshold`
 * distinct validators, if any. Deliberately takes `request` even though the
 * illustrative API sketch in docs/decision-receipt-v1.md omitted it: the
 * checklist it specifies (requestId/policyHash/profileHash/inputHash must
 * match the request) cannot be checked without it.
 */
export function selectQuorum(
  results: readonly SignedValidatorResultV1[],
  request: ExecutionRequestV1,
  validatorSet: ValidatorSetV1,
  options?: { readonly maxResultBytes?: number },
): QuorumSelectionResult {
  const { accepted, rejected } = validateForQuorum(results, request, validatorSet, options);
  const groups = groupValidatorResults(accepted);

  const collision = findExecutionHashCollisionWithDivergentKey(groups);
  if (collision) {
    return { outcome: 'EXECUTION_HASH_COLLISION', consensusKey: null, agreeingValidatorIds: [], agreeingResults: [], rejected, groups };
  }

  let best: ConsensusGroup | null = null;
  for (const group of groups) {
    if (!best || group.members.length > best.members.length) best = group;
  }

  if (best && best.members.length >= validatorSet.threshold) {
    const sortedMembers = [...best.members].sort((a, b) => a.result.validatorId.localeCompare(b.result.validatorId));
    return {
      outcome: 'QUORUM_REACHED',
      consensusKey: best.key,
      agreeingValidatorIds: sortedMembers.map((m) => m.result.validatorId),
      agreeingResults: sortedMembers,
      rejected,
      groups,
    };
  }

  return { outcome: 'NO_QUORUM', consensusKey: null, agreeingValidatorIds: [], agreeingResults: [], rejected, groups };
}
