// SPDX-License-Identifier: Apache-2.0
// Hand-kept in sync with contracts/src/DecisionAnchor.sol's IDecisionAnchor
// interface plus its constructor and custom errors. Not read from
// contracts/out at runtime -- that build artifact only exists after
// `forge build` and would make this package's runtime depend on a
// cross-language build step; the two are kept in sync by hand instead,
// the same way JSON Schema and hand-written TS interfaces are kept in
// sync elsewhere in this repo. contracts/test/DecisionAnchor.t.sol is the
// source of truth for behavior; this file only needs to match its shape.
export const DECISION_ANCHOR_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: '_authorizedSubmitter', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'anchorBatch',
    inputs: [
      { name: 'batchId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32', internalType: 'bytes32' },
      { name: 'decisionCount', type: 'uint64', internalType: 'uint64' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'authorizedSubmitter',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBatch',
    inputs: [{ name: 'batchId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      { name: 'merkleRoot', type: 'bytes32', internalType: 'bytes32' },
      { name: 'submitter', type: 'address', internalType: 'address' },
      { name: 'decisionCount', type: 'uint64', internalType: 'uint64' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'BatchAnchored',
    inputs: [
      { name: 'batchId', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'submitter', type: 'address', indexed: true, internalType: 'address' },
      { name: 'decisionCount', type: 'uint64', indexed: false, internalType: 'uint64' },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'BatchAlreadyAnchored', inputs: [{ name: 'batchId', type: 'bytes32', internalType: 'bytes32' }] },
  { type: 'error', name: 'UnauthorizedSubmitter', inputs: [{ name: 'caller', type: 'address', internalType: 'address' }] },
  { type: 'error', name: 'ZeroAuthorizedSubmitter', inputs: [] },
  { type: 'error', name: 'ZeroBatchId', inputs: [] },
  { type: 'error', name: 'ZeroDecisionCount', inputs: [] },
  { type: 'error', name: 'ZeroMerkleRoot', inputs: [] },
] as const;
