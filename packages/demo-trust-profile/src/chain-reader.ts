// SPDX-License-Identifier: Apache-2.0
// Builds a @ddn/receipt-sdk ChainReader bound to the bundled
// TrustedDemoProfileV1 chain binding. Public reference surfaces use it to
// read DecisionAnchor.sol directly from the browser (a read-only contract
// call with no wallet or private key) for computeVerificationOutcome's
// on-chain check. See docs/public-demo-boundary.md.

import { createPublicClient, http } from 'viem';
import { DECISION_ANCHOR_ABI, bytes32ToSha256Digest, sha256DigestToBytes32, type ChainReader, type OnChainBatch } from '@ddn/receipt-sdk';
import type { Sha256Digest } from '@ddn/crypto';
import type { TrustedDemoProfileV1 } from './trusted-demo-profile.js';

/** Binds a ChainReader to `profile.chain` -- callers never supply a
 * chainId/contractAddress of their own, matching "no user-supplied trust-
 * profile override in M7". */
export function createDemoChainReader(rpcUrl: string, profile: TrustedDemoProfileV1): ChainReader {
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const address = profile.chain.contractAddress as `0x${string}`;

  return {
    chainId: profile.chain.chainId,
    contractAddress: profile.chain.contractAddress,
    async getBatch(batchId: Sha256Digest): Promise<OnChainBatch> {
      const [merkleRoot, , decisionCount] = (await publicClient.readContract({
        address,
        abi: DECISION_ANCHOR_ABI,
        functionName: 'getBatch',
        args: [sha256DigestToBytes32(batchId)],
      })) as readonly [`0x${string}`, `0x${string}`, bigint];
      return { merkleRoot: bytes32ToSha256Digest(merkleRoot), decisionCount: Number(decisionCount) };
    },
  };
}
