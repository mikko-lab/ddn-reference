// SPDX-License-Identifier: Apache-2.0
// TEST-ONLY / NEVER USE IN PRODUCTION.
//
// Deploys DecisionAnchor.sol deterministically to a local
// Anvil node and fail-closed verifies the result against the bundled
// TrustedDemoProfileV1 -- the local demo stack's bootstrap script must
// call deployAndVerifyDecisionAnchor and halt on any mismatch rather than
// silently continuing with an address the explorer's public verifier
// doesn't actually trust. See docs/public-demo-boundary.md.
//
// Determinism rationale: an EVM CREATE address is
// keccak256(rlp(sender, nonce))[12:] -- a pure function of the deployer's
// address and nonce, independent of bytecode or constructor args. Anvil's
// well-known dev account #0 (mnemonic "test test test ... junk", never a
// real secret -- see apps/anchor-service's own chain-client.integration.test.ts)
// deploying as its very first transaction (nonce 0) on a freshly reset
// Anvil instance therefore always produces the same contract address.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { TrustedDemoProfileV1 } from '../trusted-demo-profile.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const CONTRACT_ARTIFACT = join(REPO_ROOT, 'contracts/out/DecisionAnchor.sol/DecisionAnchor.json');

// Anvil's well-known, publicly documented default dev account (mnemonic
// "test test test test test test test test test test test junk", account
// #0) -- never a real secret, standard practice for local-chain testing.
// Used as both deployer and authorizedSubmitter, matching
// apps/anchor-service's own Anvil integration test exactly.
export const DEMO_DEV_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const DEMO_DEV_ADDRESS: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

export function contractArtifactExists(): boolean {
  return existsSync(CONTRACT_ARTIFACT);
}

export interface DeployedDecisionAnchor {
  readonly chainId: number;
  readonly contractAddress: Hex;
}

/** Deploys DecisionAnchor.sol to whatever chain `rpcUrl` points at, using
 * the fixed dev key as both deployer and authorizedSubmitter. Only ever
 * produces the address TrustedDemoProfileV1 expects when run against a
 * freshly reset Anvil instance where this is the dev account's first
 * transaction -- see the determinism note at the top of this file. */
export async function deployDecisionAnchorDeterministically(rpcUrl: string): Promise<DeployedDecisionAnchor> {
  if (!contractArtifactExists()) {
    throw new Error(`${CONTRACT_ARTIFACT} does not exist -- run \`forge build\` in contracts/ first`);
  }
  const artifact = JSON.parse(readFileSync(CONTRACT_ARTIFACT, 'utf8')) as { abi: unknown; bytecode: { object: Hex } };
  const account = privateKeyToAccount(DEMO_DEV_PRIVATE_KEY);
  const chainId = await createPublicClient({ transport: http(rpcUrl) }).getChainId();
  const chain = {
    id: chainId,
    name: 'ddn-demo',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const deployTxHash = await walletClient.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.object,
    args: [DEMO_DEV_ADDRESS],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
  if (!receipt.contractAddress) throw new Error('deployment did not produce a contract address');
  return { chainId, contractAddress: receipt.contractAddress };
}

export class DemoTrustProfileMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoTrustProfileMismatchError';
  }
}

/** Fail-closed check: throws DemoTrustProfileMismatchError if what was
 * actually deployed doesn't match the bundled, committed
 * TrustedDemoProfileV1 -- the demo stack's bootstrap script must let this
 * throw propagate and halt startup, never catch-and-continue. */
export function assertDeployedContractMatchesTrustedProfile(deployed: DeployedDecisionAnchor, profile: TrustedDemoProfileV1): void {
  if (deployed.chainId !== profile.chain.chainId) {
    throw new DemoTrustProfileMismatchError(
      `deployed chainId ${deployed.chainId} does not match TrustedDemoProfileV1.chain.chainId ${profile.chain.chainId} -- refusing to start the demo`
    );
  }
  if (deployed.contractAddress.toLowerCase() !== profile.chain.contractAddress.toLowerCase()) {
    throw new DemoTrustProfileMismatchError(
      `deployed contract address ${deployed.contractAddress} does not match TrustedDemoProfileV1.chain.contractAddress ${profile.chain.contractAddress} -- refusing to start the demo`
    );
  }
}

/** Deploys DecisionAnchor.sol deterministically to `rpcUrl` and fail-closed
 * verifies the result against `profile` before returning. This is the one
 * function the local demo stack's bootstrap script should call -- it never
 * silently continues past a mismatch. */
export async function deployAndVerifyDecisionAnchor(rpcUrl: string, profile: TrustedDemoProfileV1): Promise<Hex> {
  const deployed = await deployDecisionAnchorDeterministically(rpcUrl);
  assertDeployedContractMatchesTrustedProfile(deployed, profile);
  return deployed.contractAddress;
}
