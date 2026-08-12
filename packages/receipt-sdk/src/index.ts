// SPDX-License-Identifier: Apache-2.0
// @ddn/receipt-sdk
//
// Milestone 4: a pure, dependency-light library for assembling and
// independently verifying a DecisionReceiptV1 from multiple validators'
// SignedValidatorResultV1s. It never spawns a process, never touches a
// private key, and never re-executes policy.wasm -- those stay the
// exclusive responsibility of the Rust ddn-validator binary and, for
// orchestration, @ddn/coordinator. See docs/decision-receipt-v1.md.

export {
  VALIDATOR_RESULT_DOMAIN_V1,
  VALIDATOR_ID_DOMAIN_V1,
  VALIDATOR_SET_DOMAIN_V1,
  DECISION_RECEIPT_DOMAIN_V1,
  ALLOWED_VALIDATOR_EXECUTION_STATUSES,
  ProtocolValidationError,
  isAllowedStatus,
  parseExecutionRequestV1,
  parseValidatorResultV1,
  parseSignedValidatorResultV1,
} from './protocol-types.js';
export type { ValidatorExecutionStatus, ExecutionRequestV1, ValidatorResultV1, SignedValidatorResultV1 } from './protocol-types.js';

export { deriveValidatorId, verifySignedValidatorResultSignature, validatorIdMatchesPublicKey } from './validator-identity.js';

export {
  buildValidatorSetV1,
  computeValidatorSetId,
  parseValidatorSetV1,
} from './validator-set.js';
export type { ValidatorSetV1, ValidatorSetMemberV1, ValidatorSetContentV1 } from './validator-set.js';

export {
  consensusKeyOf,
  consensusKeysEqual,
  groupValidatorResults,
  findExecutionHashCollisionWithDivergentKey,
  validateForQuorum,
  selectQuorum,
} from './consensus.js';
export type {
  ConsensusKeyV1,
  ConsensusGroup,
  RejectedResultReason,
  RejectedResult,
  QuorumValidationResult,
  QuorumOutcome,
  QuorumSelectionResult,
} from './consensus.js';

export {
  computeReceiptId,
  buildDecisionReceipt,
  buildCoordinatorFailure,
  parseDecisionReceiptV1,
  verifyDecisionReceipt,
} from './decision-receipt.js';
export type {
  DecisionReceiptV1,
  DecisionReceiptQuorumV1,
  DecisionReceiptContentV1,
  CoordinatorFailureV1,
  ReceiptVerificationCheck,
  ReceiptVerificationResult,
} from './decision-receipt.js';

export {
  RECEIPT_LEAF_DOMAIN_V1,
  MERKLE_NODE_DOMAIN_V1,
  ANCHOR_BATCH_DOMAIN_V1,
  MerkleError,
  computeLeafHash,
  buildMerkleTree,
  buildMerkleProof,
  verifyMerkleProof,
  computeBatchId,
} from './merkle.js';
export type { MerkleProofV1, MerkleTreeV1, MerkleErrorCode, MerkleVerificationResult } from './merkle.js';

export { parseAnchorRecordV1 } from './anchor-record.js';
export type { AnchorRecordV1, AnchorChainBindingV1, AnchorConfirmationV1 } from './anchor-record.js';

export { verifyReceiptAgainstSuppliedBatch, verifyAnchoredDecisionReceipt } from './anchor-verification.js';
export type {
  AnchoredVerificationFailure,
  AnchoredVerificationResult,
  OnChainBatch,
  TrustedChainBinding,
  ChainReader,
} from './anchor-verification.js';

export { computeVerificationOutcome } from './verification-outcome.js';
export type { VerificationOutcome, VerificationOutcomeResult } from './verification-outcome.js';

export { DECISION_ANCHOR_ABI } from './decision-anchor-abi.js';

export { Bytes32ConversionError, sha256DigestToBytes32, bytes32ToSha256Digest } from './bytes32.js';
