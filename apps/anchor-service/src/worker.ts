// SPDX-License-Identifier: Apache-2.0
// Milestone 6: drains ELIGIBLE sidecar entries into batches, submits them
// on-chain, and tracks confirmation/reorg. Entirely in-process, single
// instance, no durability beyond the process's own lifetime -- see
// sidecar-store.ts's header and the Milestone 6 "strictly local"
// cross-process-handoff design. Durable multi-instance operation is out of
// scope.

import type { Sha256Digest } from '@ddn/crypto';
import { buildMerkleProof, buildMerkleTree, computeBatchId, type AnchorRecordV1, type MerkleProofV1, type MerkleTreeV1 } from '@ddn/receipt-sdk';
import type { AnchorChainClientLike } from './chain-client.js';
import { AnchorSidecarStore, type AnchorSidecarEntry } from './sidecar-store.js';

export interface AnchorWorkerConfig {
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly confirmationBlocks: number;
}

interface PendingBatch {
  readonly tree: MerkleTreeV1;
  readonly txHash: string;
}

interface ConfirmationEvidence {
  readonly txHash: string;
  readonly blockNumber: bigint;
  readonly blockHash: string;
}

/** A safe, bounded log line for an unexpected error -- just the message,
 * never the full error object (which for an RPC/transport failure can
 * embed request/response detail we don't want dumped wholesale) and never
 * anything from AnchorChainClientConfig (submitterPrivateKey never flows
 * through error objects surfaced here; see chain-client.ts). */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AnchorWorker {
  private readonly pendingBatches = new Map<Sha256Digest, PendingBatch>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: AnchorSidecarStore,
    private readonly chainClient: AnchorChainClientLike,
    private readonly config: AnchorWorkerConfig
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.config.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Never rejects -- every internal phase already contains its own
   * per-batch/per-entry error handling, but this is the final backstop so
   * a genuinely unexpected exception anywhere in runTick() can never
   * become an unhandled promise rejection from the setInterval callback
   * in start(), which fires this without awaiting it. */
  async tick(): Promise<void> {
    try {
      await this.runTick();
    } catch (error) {
      console.error(`anchor worker: unexpected error during tick, state left unchanged, will retry next interval: ${describeError(error)}`);
    }
  }

  private async runTick(): Promise<void> {
    await this.submitEligibleBatch();
    await this.checkSubmittedConfirmations();
    await this.resolveReorgPending();
    await this.checkConfirmedForReorgs();
  }

  private async submitEligibleBatch(): Promise<void> {
    const entries = this.store.listEligible(this.config.batchSize);
    if (entries.length === 0) return;

    const receiptIds = entries.map((e) => e.receiptId);
    const tree = buildMerkleTree(receiptIds);
    const decisionCount = tree.leaves.length;
    const batchId = computeBatchId(tree.root, decisionCount);
    this.store.markBatched(receiptIds, batchId);

    try {
      const { txHash } = await this.chainClient.submitAnchorBatch(batchId, tree.root, decisionCount);
      this.store.markSubmitted(receiptIds, txHash);
      this.pendingBatches.set(batchId, { tree, txHash });
    } catch (error) {
      const reason = describeError(error);
      console.error(`anchor worker: submitAnchorBatch failed for batchId ${batchId}: ${reason}`);
      for (const receiptId of receiptIds) this.store.markRetryableFailure(receiptId, reason);
    }
  }

  private applyConfirmation(
    entries: readonly AnchorSidecarEntry[],
    merkleRoot: Sha256Digest,
    batchId: Sha256Digest,
    proofFor: (receiptId: Sha256Digest) => MerkleProofV1 | undefined,
    evidence: ConfirmationEvidence
  ): void {
    const confirmedAt = new Date().toISOString();
    for (const entry of entries) {
      const proof = proofFor(entry.receiptId);
      if (!proof) continue; // unreachable in practice: every path here supplies either a live tree or a prior anchorRecord's proof
      const anchorRecord: AnchorRecordV1 = {
        schemaVersion: '1.0.0',
        receiptId: entry.receiptId,
        batchId,
        merkleRoot,
        proof,
        chain: { chainId: this.chainClient.chainId, contractAddress: this.chainClient.contractAddress },
        confirmation: {
          txHash: evidence.txHash,
          blockNumber: Number(evidence.blockNumber),
          blockHash: evidence.blockHash,
          confirmedAt,
        },
      };
      this.store.markConfirmed(entry.receiptId, anchorRecord);
    }
  }

  private async checkSubmittedConfirmations(): Promise<void> {
    for (const [batchId, pending] of this.pendingBatches) {
      try {
        const outcome = await this.chainClient.getTransactionOutcome(pending.txHash as `0x${string}`);
        if (!outcome) continue; // not yet mined

        const entries = this.store.listSubmittedByBatch().get(batchId) ?? [];
        if (outcome.status !== 'success') {
          const reason = `transaction ${pending.txHash} reverted`;
          console.error(`anchor worker: ${reason}`);
          for (const entry of entries) this.store.markRetryableFailure(entry.receiptId, reason);
          this.pendingBatches.delete(batchId);
          continue;
        }

        const currentBlockNumber = await this.chainClient.getBlockNumber();
        const confirmations = currentBlockNumber - outcome.blockNumber + 1n;
        if (confirmations < BigInt(this.config.confirmationBlocks)) continue;

        const blockAtNumber = await this.chainClient.getBlock(outcome.blockNumber);
        if (blockAtNumber.hash !== outcome.blockHash) {
          // Reorged out between submission and this confirmation check --
          // do not confirm. Deliberately NOT deleted from pendingBatches
          // here: resolveReorgPending() runs right after this method, in
          // the same tick, and needs this entry's tree to rebuild proofs if
          // the transaction turns out to have actually landed elsewhere.
          for (const entry of entries) this.store.markReorgPending(entry.receiptId);
          continue;
        }

        this.applyConfirmation(entries, pending.tree.root, batchId, (id) => buildMerkleProof(pending.tree, id), {
          txHash: pending.txHash,
          blockNumber: outcome.blockNumber,
          blockHash: outcome.blockHash,
        });
        this.pendingBatches.delete(batchId);
      } catch (error) {
        // A transport/RPC/decode error here is transient, not a
        // determination that anything is wrong with the batch itself --
        // leave its state exactly as-is and retry this same check next
        // tick, rather than treating an outage as a revert or a reorg.
        console.error(
          `anchor worker: transient error checking confirmation for batchId ${batchId}, state left unchanged, will retry next tick: ${describeError(error)}`
        );
      }
    }
  }

  /** Resolves every REORG_PENDING batch: re-fetches getBatch from chain.
   * If it still reports this batch's content, the transaction actually
   * landed (possibly under a different block than last recorded) --
   * re-locate the confirming event and restore CONFIRMED with fresh block
   * evidence, reusing each entry's already-known proof (a REORG_PENDING
   * entry always arrives from either a still-open pendingBatches tree or a
   * prior CONFIRMED anchorRecord, so a proof is always available without
   * rebuilding the tree). If getBatch reports different or no content, the
   * transaction was genuinely dropped -- fall back to ELIGIBLE so a fresh
   * batch gets built and submitted next tick. */
  private async resolveReorgPending(): Promise<void> {
    for (const [batchId, entries] of this.store.listReorgPendingByBatch()) {
      try {
        const pending = this.pendingBatches.get(batchId);
        const expectedRoot = pending?.tree.root ?? entries.find((e) => e.anchorRecord)?.anchorRecord?.merkleRoot;

        if (expectedRoot) {
          const onChain = await this.chainClient.getBatch(batchId);
          if (onChain.merkleRoot === expectedRoot && onChain.decisionCount === entries.length) {
            const event = await this.chainClient.findAnchoredEvent(batchId);
            if (event) {
              const proofFor = (id: Sha256Digest): MerkleProofV1 | undefined =>
                pending ? buildMerkleProof(pending.tree, id) : entries.find((e) => e.receiptId === id)?.anchorRecord?.proof;
              this.applyConfirmation(entries, expectedRoot, batchId, proofFor, {
                txHash: event.txHash,
                blockNumber: event.blockNumber,
                blockHash: event.blockHash,
              });
              this.pendingBatches.delete(batchId);
              continue;
            }
          }
        }

        const reason = `batchId ${batchId} did not survive the reorg -- resubmitting`;
        console.error(`anchor worker: ${reason}`);
        for (const entry of entries) this.store.markRetryableFailure(entry.receiptId, reason);
        this.pendingBatches.delete(batchId);
      } catch (error) {
        console.error(
          `anchor worker: transient error resolving reorg for batchId ${batchId}, state left unchanged, will retry next tick: ${describeError(error)}`
        );
      }
    }
  }

  /** Periodically re-checks already-CONFIRMED batches against the current
   * chain state -- a batch that was fine on the last tick can still be
   * reorged out later. Anvil (single-node, local) makes this low-risk in
   * practice for this local reference profile. The check is retained as a
   * protocol-safety property; this repository makes no testnet commitment. */
  private async checkConfirmedForReorgs(): Promise<void> {
    for (const entries of this.store.listConfirmedByBlock().values()) {
      const sample = entries[0];
      if (!sample?.anchorRecord) continue;
      try {
        const blockNumber = BigInt(sample.anchorRecord.confirmation.blockNumber);
        const currentBlock = await this.chainClient.getBlock(blockNumber);
        if (currentBlock.hash !== sample.anchorRecord.confirmation.blockHash) {
          for (const entry of entries) this.store.markReorgPending(entry.receiptId);
        }
      } catch (error) {
        console.error(
          `anchor worker: transient error re-checking a confirmed batch for reorg, state left unchanged, will retry next tick: ${describeError(error)}`
        );
      }
    }
  }
}
