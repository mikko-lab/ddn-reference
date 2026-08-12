// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DecisionAnchor, IDecisionAnchor} from "../src/DecisionAnchor.sol";

contract DecisionAnchorTest is Test {
    DecisionAnchor public anchor;
    address public submitter = address(0xA11CE);
    address public stranger = address(0xB0B);

    bytes32 constant ROOT_A = bytes32(uint256(1));
    bytes32 constant BATCH_A = bytes32(uint256(100));

    function setUp() public {
        anchor = new DecisionAnchor(submitter);
    }

    // --- constructor ---------------------------------------------------

    function test_RevertsOnZeroAuthorizedSubmitter() public {
        vm.expectRevert(DecisionAnchor.ZeroAuthorizedSubmitter.selector);
        new DecisionAnchor(address(0));
    }

    function test_AuthorizedSubmitterIsSetImmutably() public view {
        assertEq(anchor.authorizedSubmitter(), submitter);
    }

    // --- authorization ---------------------------------------------------

    function test_AnchorBatchSucceedsFromAuthorizedSubmitter() public {
        vm.prank(submitter);
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);

        (bytes32 root, address recordedSubmitter, uint64 count) = anchor.getBatch(BATCH_A);
        assertEq(root, ROOT_A);
        assertEq(recordedSubmitter, submitter);
        assertEq(count, 3);
    }

    function test_AnchorBatchRevertsFromUnauthorizedSubmitter() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.UnauthorizedSubmitter.selector, stranger));
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);
    }

    function test_BatchAnchoredEventEmitsExpectedFields() public {
        vm.expectEmit(true, true, true, true);
        emit IDecisionAnchor.BatchAnchored(BATCH_A, ROOT_A, submitter, 3);
        vm.prank(submitter);
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);
    }

    // --- zero-value rejection ---------------------------------------------------

    function test_AnchorBatchRevertsOnZeroBatchId() public {
        vm.prank(submitter);
        vm.expectRevert(DecisionAnchor.ZeroBatchId.selector);
        anchor.anchorBatch(bytes32(0), ROOT_A, 3);
    }

    function test_AnchorBatchRevertsOnZeroMerkleRoot() public {
        vm.prank(submitter);
        vm.expectRevert(DecisionAnchor.ZeroMerkleRoot.selector);
        anchor.anchorBatch(BATCH_A, bytes32(0), 3);
    }

    function test_AnchorBatchRevertsOnZeroDecisionCount() public {
        vm.prank(submitter);
        vm.expectRevert(DecisionAnchor.ZeroDecisionCount.selector);
        anchor.anchorBatch(BATCH_A, ROOT_A, 0);
    }

    // --- reuse: prevented unconditionally, matching or conflicting content ---------------------------------------------------

    function test_AnchorBatchRevertsOnExactMatchResubmission() public {
        vm.startPrank(submitter);
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);
        vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.BatchAlreadyAnchored.selector, BATCH_A));
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);
        vm.stopPrank();
    }

    function test_AnchorBatchRevertsOnConflictingMerkleRootResubmission() public {
        vm.startPrank(submitter);
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);
        vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.BatchAlreadyAnchored.selector, BATCH_A));
        anchor.anchorBatch(BATCH_A, bytes32(uint256(2)), 3);
        vm.stopPrank();
    }

    function test_AnchorBatchRevertsOnConflictingDecisionCountResubmission() public {
        vm.startPrank(submitter);
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);
        vm.expectRevert(abi.encodeWithSelector(DecisionAnchor.BatchAlreadyAnchored.selector, BATCH_A));
        anchor.anchorBatch(BATCH_A, ROOT_A, 4);
        vm.stopPrank();
    }

    // --- reads ---------------------------------------------------

    function test_GetBatchReturnsZeroValuesForNeverAnchoredBatch() public view {
        (bytes32 root, address recordedSubmitter, uint64 count) = anchor.getBatch(bytes32(uint256(999)));
        assertEq(root, bytes32(0));
        assertEq(recordedSubmitter, address(0));
        assertEq(count, 0);
    }

    function test_DifferentBatchIdsAreIndependent() public {
        vm.startPrank(submitter);
        anchor.anchorBatch(BATCH_A, ROOT_A, 3);
        anchor.anchorBatch(bytes32(uint256(101)), bytes32(uint256(2)), 5);
        vm.stopPrank();

        (bytes32 rootA,, uint64 countA) = anchor.getBatch(BATCH_A);
        (bytes32 rootB,, uint64 countB) = anchor.getBatch(bytes32(uint256(101)));
        assertEq(rootA, ROOT_A);
        assertEq(countA, 3);
        assertEq(rootB, bytes32(uint256(2)));
        assertEq(countB, 5);
    }
}
