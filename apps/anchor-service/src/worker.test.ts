// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sha256Digest } from '@ddn/crypto';
import type { DecisionReceiptV1, OnChainBatch } from '@ddn/receipt-sdk';
import { AnchorSidecarStore } from './sidecar-store.js';
import { AnchorWorker } from './worker.js';
import type { AnchorChainClientLike, AnchoredEvent, BlockInfo, SubmittedBatch, TransactionOutcome } from './chain-client.js';

function sha(byte: string): Sha256Digest {
  return `sha256:${byte.repeat(32)}` as Sha256Digest;
}

const FAKE_RECEIPT = {} as DecisionReceiptV1;

class FakeChainClient implements AnchorChainClientLike {
  readonly chainId = 31337;
  readonly contractAddress = '0x' + 'ab'.repeat(20);

  submitAnchorBatchImpl: (batchId: Sha256Digest, merkleRoot: Sha256Digest, decisionCount: number) => Promise<SubmittedBatch> = async () => ({
    txHash: '0xdefault',
  });
  getBatchImpl: (batchId: Sha256Digest) => Promise<OnChainBatch> = async () => ({ merkleRoot: sha('0'), decisionCount: 0 });
  getTransactionOutcomeImpl: (txHash: `0x${string}`) => Promise<TransactionOutcome | null> = async () => null;
  getBlockNumberImpl: () => Promise<bigint> = async () => 0n;
  getBlockImpl: (blockNumber: bigint) => Promise<BlockInfo> = async (n) => ({ number: n, hash: '0x0' as `0x${string}` });
  findAnchoredEventImpl: (batchId: Sha256Digest) => Promise<AnchoredEvent | null> = async () => null;

  async getBatch(batchId: Sha256Digest) {
    return this.getBatchImpl(batchId);
  }
  async submitAnchorBatch(batchId: Sha256Digest, merkleRoot: Sha256Digest, decisionCount: number) {
    return this.submitAnchorBatchImpl(batchId, merkleRoot, decisionCount);
  }
  async findAnchoredEvent(batchId: Sha256Digest) {
    return this.findAnchoredEventImpl(batchId);
  }
  async getTransactionOutcome(txHash: `0x${string}`) {
    return this.getTransactionOutcomeImpl(txHash);
  }
  async getBlockNumber() {
    return this.getBlockNumberImpl();
  }
  async getBlock(blockNumber: bigint) {
    return this.getBlockImpl(blockNumber);
  }
}

test('happy path: ELIGIBLE -> BATCHED -> SUBMITTED across one tick, then CONFIRMED on the next', async () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  let submittedRoot: Sha256Digest | undefined;
  fake.submitAnchorBatchImpl = async (_batchId, merkleRoot) => {
    submittedRoot = merkleRoot;
    return { txHash: '0xtx1' };
  };
  let outcomeCalls = 0;
  fake.getTransactionOutcomeImpl = async () => {
    outcomeCalls++;
    if (outcomeCalls < 2) return null; // not yet mined on the first check
    return { status: 'success', blockNumber: 10n, blockHash: '0xblock10' as `0x${string}` };
  };
  fake.getBlockNumberImpl = async () => 12n;
  fake.getBlockImpl = async (n) => ({ number: n, hash: '0xblock10' as `0x${string}` });

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 2 });

  await worker.tick();
  assert.equal(store.getByReceiptId(id)?.status, 'SUBMITTED');

  await worker.tick();
  const entry = store.getByReceiptId(id);
  assert.equal(entry?.status, 'CONFIRMED');
  assert.equal(entry?.anchorRecord?.merkleRoot, submittedRoot);
  assert.equal(entry?.anchorRecord?.confirmation.blockNumber, 10);
  assert.equal(entry?.anchorRecord?.confirmation.txHash, '0xtx1');
});

test('confirmation waits for the configured number of confirmation blocks', async () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  fake.submitAnchorBatchImpl = async () => ({ txHash: '0xtx1' });
  fake.getTransactionOutcomeImpl = async () => ({ status: 'success', blockNumber: 10n, blockHash: '0xblockA' as `0x${string}` });
  fake.getBlockNumberImpl = async () => 10n; // only 1 confirmation so far
  fake.getBlockImpl = async (n) => ({ number: n, hash: '0xblockA' as `0x${string}` });

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 5 });
  await worker.tick();
  await worker.tick();
  assert.equal(store.getByReceiptId(id)?.status, 'SUBMITTED');
});

test('a reverted transaction is a retryable failure, returning the entry to ELIGIBLE', async () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  fake.submitAnchorBatchImpl = async () => ({ txHash: '0xtx1' });
  fake.getTransactionOutcomeImpl = async () => ({ status: 'reverted', blockNumber: 10n, blockHash: '0xblockA' as `0x${string}` });

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 1 });
  await worker.tick(); // submit-then-detect-revert completes within this one tick
  const entry = store.getByReceiptId(id);
  assert.equal(entry?.status, 'ELIGIBLE');
  assert.equal(entry?.retryCount, 1);
});

test('submitAnchorBatch throwing marks every entry in the attempted batch as a retryable failure', async () => {
  const store = new AnchorSidecarStore();
  const ids = [sha('a'), sha('b')];
  for (const [i, id] of ids.entries()) store.markEligible(`dec_${i}`, 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  fake.submitAnchorBatchImpl = async () => {
    throw new Error('rpc unreachable');
  };

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 1 });
  await worker.tick();
  for (const id of ids) {
    const entry = store.getByReceiptId(id);
    assert.equal(entry?.status, 'ELIGIBLE');
    assert.equal(entry?.retryCount, 1);
    assert.equal(entry?.lastError, 'rpc unreachable');
  }
});

test('a reorg detected at confirmation time resolves back to CONFIRMED within the same tick once getBatch shows it actually landed', async () => {
  // Detection (checkSubmittedConfirmations) and resolution
  // (resolveReorgPending) both run within one tick() call, in sequence --
  // so the fake must be configured for the fully-resolved end state
  // upfront, not reconfigured mid-test between two tick() calls.
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  let submittedRoot: Sha256Digest | undefined;
  fake.submitAnchorBatchImpl = async (_batchId, merkleRoot) => {
    submittedRoot = merkleRoot;
    return { txHash: '0xtx1' };
  };
  fake.getTransactionOutcomeImpl = async () => ({ status: 'success', blockNumber: 10n, blockHash: '0xstaleBlock' as `0x${string}` });
  fake.getBlockNumberImpl = async () => 11n;
  // The block at height 10 no longer matches what the receipt claimed --
  // a reorg discovered right at confirmation time.
  fake.getBlockImpl = async (n) => ({ number: n, hash: '0xnewBlock' as `0x${string}` });
  // But getBatch still reports this batch's exact content as anchored --
  // the transaction actually landed, just re-mined under a new block.
  fake.getBatchImpl = async () => ({ merkleRoot: submittedRoot ?? sha('unset'), decisionCount: 1 });
  fake.findAnchoredEventImpl = async () => ({ txHash: '0xtx1-relocated', blockNumber: 11n, blockHash: '0xnewBlock' as `0x${string}` });

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 1 });
  await worker.tick();

  const entry = store.getByReceiptId(id);
  assert.equal(entry?.status, 'CONFIRMED');
  assert.equal(entry?.anchorRecord?.confirmation.txHash, '0xtx1-relocated');
  assert.equal(entry?.anchorRecord?.confirmation.blockNumber, 11);
});

test('a reorg that genuinely dropped the batch falls back to ELIGIBLE for rebatching within the same tick', async () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  fake.submitAnchorBatchImpl = async () => ({ txHash: '0xtx1' });
  fake.getTransactionOutcomeImpl = async () => ({ status: 'success', blockNumber: 10n, blockHash: '0xstaleBlock' as `0x${string}` });
  fake.getBlockNumberImpl = async () => 11n;
  fake.getBlockImpl = async (n) => ({ number: n, hash: '0xnewBlock' as `0x${string}` });
  // getBatchImpl's default (zero merkleRoot/decisionCount) already models
  // "nothing landed" -- the transaction was genuinely dropped by the reorg.

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 1 });
  await worker.tick();

  const entry = store.getByReceiptId(id);
  assert.equal(entry?.status, 'ELIGIBLE');
  assert.equal(entry?.retryCount, 1);
});

test('checkConfirmedForReorgs demotes an already-CONFIRMED entry whose block hash no longer matches the chain', async () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  fake.submitAnchorBatchImpl = async () => ({ txHash: '0xtx1' });
  fake.getTransactionOutcomeImpl = async () => ({ status: 'success', blockNumber: 10n, blockHash: '0xblockA' as `0x${string}` });
  fake.getBlockNumberImpl = async () => 11n;
  fake.getBlockImpl = async (n) => ({ number: n, hash: '0xblockA' as `0x${string}` }); // matches -> confirms cleanly

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 1 });
  await worker.tick();
  assert.equal(store.getByReceiptId(id)?.status, 'CONFIRMED');

  // Now the chain reports a different hash at that same block height.
  fake.getBlockImpl = async (n) => ({ number: n, hash: '0xreorgedAway' as `0x${string}` });
  await worker.tick();
  assert.equal(store.getByReceiptId(id)?.status, 'REORG_PENDING');
});

// --- a genuine RPC/transport error must never be treated as "still
// pending" or as a determination that something is actually wrong with
// the batch -- state must be left untouched and the tick must never reject ---

test('a thrown (non-null) getTransactionOutcome error leaves the entry untouched, not marked failed', async () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  fake.submitAnchorBatchImpl = async () => ({ txHash: '0xtx1' });
  fake.getTransactionOutcomeImpl = async () => {
    throw new Error('ECONNREFUSED: rpc endpoint unreachable');
  };

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 1 });
  await worker.tick(); // submits, then the confirmation check throws internally

  const entry = store.getByReceiptId(id);
  assert.equal(entry?.status, 'SUBMITTED', 'a transient RPC error must not change status');
  assert.equal(entry?.retryCount, 0, 'a transient RPC error must not consume a retry attempt');
});

test('tick() never rejects even when a chain-client call throws unexpectedly mid-phase', async () => {
  const store = new AnchorSidecarStore();
  const id = sha('a');
  store.markEligible('dec_1', 'tenant-a', id, FAKE_RECEIPT);

  const fake = new FakeChainClient();
  fake.submitAnchorBatchImpl = async () => {
    throw new Error('unexpected: this should already be caught inside submitEligibleBatch');
  };
  fake.getBlockNumberImpl = async () => {
    throw new Error('unexpected transport failure');
  };
  fake.getBlockImpl = async () => {
    throw new Error('unexpected transport failure');
  };

  const worker = new AnchorWorker(store, fake, { pollIntervalMs: 1000, batchSize: 10, confirmationBlocks: 1 });
  await assert.doesNotReject(() => worker.tick());
});
