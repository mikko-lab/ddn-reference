// SPDX-License-Identifier: Apache-2.0
// Milestone 6: the anchor worker's broader chain client -- submission,
// transaction receipts, and block/blockHash reads for confirmation and
// reorg tracking. Deliberately separate from @ddn/receipt-sdk's own
// lightweight ChainReader (just getBatch, bound to one chainId/
// contractAddress), which is all a verifier needs. AnchorChainClient
// satisfies ChainReader structurally, so it can be passed anywhere one is
// expected, but its own type surface here is broader.

import {
  createPublicClient,
  createWalletClient,
  http,
  BaseError,
  ContractFunctionRevertedError,
  TransactionReceiptNotFoundError,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Sha256Digest } from '@ddn/crypto';
import { DECISION_ANCHOR_ABI, bytes32ToSha256Digest, sha256DigestToBytes32, type ChainReader, type OnChainBatch } from '@ddn/receipt-sdk';

export interface AnchorChainClientConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly contractAddress: Hex;
  readonly submitterPrivateKey: Hex;
}

export interface SubmittedBatch {
  readonly txHash: Hex;
}

export interface TransactionOutcome {
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

export interface BlockInfo {
  readonly number: bigint;
  readonly hash: Hex;
}

export interface AnchoredEvent {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

function localChain(chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: `ddn-anchor-${chainId}`,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

/** Thrown by AnchorChainClient's constructor in place of whatever
 * privateKeyToAccount itself threw -- deliberately discarding the original
 * error, which may be a viem error embedding the invalid input value
 * itself. Never include the key, and never attach the original error (not
 * even as `cause`), so a caller logging this exception in full can never
 * end up printing key material. See docs/api-security-model.md's "Key and
 * validator-process boundaries". */
export class AnchorKeyConfigurationError extends Error {
  constructor() {
    super('the configured anchor submitter private key is invalid -- check DDN_ANCHOR_SUBMITTER_PRIVATE_KEY');
    this.name = 'AnchorKeyConfigurationError';
  }
}

function isBatchAlreadyAnchoredError(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'BatchAlreadyAnchored';
}

/** The broader chain client shape AnchorWorker depends on -- an interface,
 * not the concrete AnchorChainClient class, so tests can substitute a fake
 * without fighting TypeScript's structural typing over private fields. */
export interface AnchorChainClientLike extends ChainReader {
  submitAnchorBatch(batchId: Sha256Digest, merkleRoot: Sha256Digest, decisionCount: number): Promise<SubmittedBatch>;
  findAnchoredEvent(batchId: Sha256Digest): Promise<AnchoredEvent | null>;
  getTransactionOutcome(txHash: Hex): Promise<TransactionOutcome | null>;
  getBlockNumber(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<BlockInfo>;
}

export class AnchorChainClient implements AnchorChainClientLike {
  readonly chainId: number;
  readonly contractAddress: string;
  private readonly address: Hex;
  private readonly publicClient: ReturnType<typeof createPublicClient>;
  private readonly walletClient: ReturnType<typeof createWalletClient>;

  constructor(config: AnchorChainClientConfig) {
    this.chainId = config.chainId;
    this.contractAddress = config.contractAddress;
    this.address = config.contractAddress;
    const chain = localChain(config.chainId, config.rpcUrl);
    let account;
    try {
      account = privateKeyToAccount(config.submitterPrivateKey);
    } catch {
      // Deliberately discards whatever privateKeyToAccount threw -- see
      // AnchorKeyConfigurationError's own doc comment above.
      throw new AnchorKeyConfigurationError();
    }
    this.publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    this.walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  }

  async getBatch(batchId: Sha256Digest): Promise<OnChainBatch> {
    const [merkleRoot, , decisionCount] = (await this.publicClient.readContract({
      address: this.address,
      abi: DECISION_ANCHOR_ABI,
      functionName: 'getBatch',
      args: [sha256DigestToBytes32(batchId)],
    })) as readonly [Hex, Hex, bigint];
    return { merkleRoot: bytes32ToSha256Digest(merkleRoot), decisionCount: Number(decisionCount) };
  }

  /**
   * Submits anchorBatch. If the contract reverts with BatchAlreadyAnchored,
   * this is treated as a successful idempotent retry ONLY if the on-chain
   * content (re-fetched via getBatch) matches exactly what we intended to
   * submit -- the original BatchAnchored event is then looked up (indexed
   * by batchId) to recover its txHash/block evidence, since this call
   * itself produced no new transaction. Any other outcome -- a genuine
   * revert, or an on-chain mismatch -- is fail-closed and thrown: content
   * differing from what was already anchored under the same batchId is
   * never silently accepted as a retry.
   */
  async submitAnchorBatch(batchId: Sha256Digest, merkleRoot: Sha256Digest, decisionCount: number): Promise<SubmittedBatch> {
    const batchIdHex = sha256DigestToBytes32(batchId);
    const merkleRootHex = sha256DigestToBytes32(merkleRoot);
    try {
      const txHash = await this.walletClient.writeContract({
        address: this.address,
        abi: DECISION_ANCHOR_ABI,
        functionName: 'anchorBatch',
        args: [batchIdHex, merkleRootHex, BigInt(decisionCount)],
      } as never);
      return { txHash };
    } catch (error) {
      if (!isBatchAlreadyAnchoredError(error)) throw error;
      const onChain = await this.getBatch(batchId);
      if (onChain.merkleRoot !== merkleRoot || onChain.decisionCount !== decisionCount) {
        throw new Error(`batchId ${batchId} is already anchored with conflicting content -- refusing to treat this as a retry`);
      }
      const event = await this.findAnchoredEvent(batchId);
      if (!event) {
        throw new Error(`batchId ${batchId} reports BatchAlreadyAnchored but no matching BatchAnchored event was found`);
      }
      return { txHash: event.txHash };
    }
  }

  async findAnchoredEvent(batchId: Sha256Digest): Promise<AnchoredEvent | null> {
    const logs = await this.publicClient.getContractEvents({
      address: this.address,
      abi: DECISION_ANCHOR_ABI,
      eventName: 'BatchAnchored',
      args: { batchId: sha256DigestToBytes32(batchId) },
      fromBlock: 0n,
      toBlock: 'latest',
    });
    const log = logs[0];
    if (!log || log.blockNumber === null || log.blockHash === null) return null;
    return { txHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash };
  }

  /** Returns null ONLY for the genuine "not yet mined" case (viem's
   * TransactionReceiptNotFoundError, thrown when the RPC node has no
   * receipt for this hash at all). Any other failure -- RPC/transport
   * errors, decode errors, anything else -- is rethrown; it must never be
   * folded into "still pending", since that would silently mask a real
   * outage as ordinary confirmation latency. */
  async getTransactionOutcome(txHash: Hex): Promise<TransactionOutcome | null> {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
      return { status: receipt.status, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }

  async getBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  async getBlock(blockNumber: bigint): Promise<BlockInfo> {
    const block = await this.publicClient.getBlock({ blockNumber });
    return { number: block.number, hash: block.hash };
  }
}
