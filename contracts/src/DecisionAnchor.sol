// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

// See docs/anchor-v1.md and ADR-001. This contract's only job
// is to make a batch's Merkle root tamper-evident and timestamped -- it
// never executes DDN's business logic and never stores raw decision data
// (see ADR-005). The constructor and access-control check inside anchorBatch
// close an unauthorized-submitter / front-running gap in the minimal public
// interface.
interface IDecisionAnchor {
    event BatchAnchored(
        bytes32 indexed batchId, bytes32 indexed merkleRoot, address indexed submitter, uint64 decisionCount
    );

    function anchorBatch(bytes32 batchId, bytes32 merkleRoot, uint64 decisionCount) external;

    function getBatch(bytes32 batchId)
        external
        view
        returns (bytes32 merkleRoot, address submitter, uint64 decisionCount);
}

contract DecisionAnchor is IDecisionAnchor {
    error ZeroAuthorizedSubmitter();
    error UnauthorizedSubmitter(address caller);
    error ZeroBatchId();
    error ZeroMerkleRoot();
    error ZeroDecisionCount();
    error BatchAlreadyAnchored(bytes32 batchId);

    struct Batch {
        bytes32 merkleRoot;
        address submitter;
        uint64 decisionCount;
    }

    address public immutable authorizedSubmitter;

    mapping(bytes32 => Batch) private batches;

    constructor(address _authorizedSubmitter) {
        if (_authorizedSubmitter == address(0)) revert ZeroAuthorizedSubmitter();
        authorizedSubmitter = _authorizedSubmitter;
    }

    /// Prevents reuse of a given batchId unconditionally -- a resubmission
    /// with matching content and a resubmission with conflicting content
    /// both revert with the same error. The off-chain anchor service is
    /// responsible for treating "reverted, and getBatch's stored content
    /// matches what I meant to submit" as a successful idempotent retry;
    /// this contract never carves out that exception itself, since doing so
    /// on-chain would require trusting the caller's claim that the retry is
    /// really a no-op rather than an attempted overwrite.
    function anchorBatch(bytes32 batchId, bytes32 merkleRoot, uint64 decisionCount) external {
        if (msg.sender != authorizedSubmitter) revert UnauthorizedSubmitter(msg.sender);
        if (batchId == bytes32(0)) revert ZeroBatchId();
        if (merkleRoot == bytes32(0)) revert ZeroMerkleRoot();
        if (decisionCount == 0) revert ZeroDecisionCount();
        // A stored submitter is never address(0) (rejected above), so this
        // doubles as the "does this batchId already exist" check without a
        // separate presence flag -- Solidity's zero-value default for an
        // unset mapping entry can never be mistaken for a real, anchored one.
        if (batches[batchId].submitter != address(0)) revert BatchAlreadyAnchored(batchId);

        batches[batchId] = Batch({merkleRoot: merkleRoot, submitter: msg.sender, decisionCount: decisionCount});
        emit BatchAnchored(batchId, merkleRoot, msg.sender, decisionCount);
    }

    function getBatch(bytes32 batchId)
        external
        view
        returns (bytes32 merkleRoot, address submitter, uint64 decisionCount)
    {
        Batch storage b = batches[batchId];
        return (b.merkleRoot, b.submitter, b.decisionCount);
    }
}
