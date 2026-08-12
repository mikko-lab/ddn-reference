// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { TrustedDemoProfileV1 } from './trusted-demo-profile.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const CONTRACT_ARTIFACT = join(REPO_ROOT, 'contracts/out/DecisionAnchor.sol/DecisionAnchor.json');

export function contractArtifactExists(): boolean {
  return existsSync(CONTRACT_ARTIFACT);
}

export interface DeployedDecisionAnchor {
  readonly chainId: number;
  readonly contractAddress: Hex;
}

/** Deploys DecisionAnchor.sol with an explicitly supplied, runtime-only
 * local-chain account. The caller owns key generation and lifetime; this
 * module never embeds, persists, or logs a private key. */
export async function deployDecisionAnchor(rpcUrl: string, submitterPrivateKey: Hex): Promise<DeployedDecisionAnchor> {
  if (!contractArtifactExists()) {
    throw new Error(`${CONTRACT_ARTIFACT} does not exist -- run \`forge build\` in contracts/ first`);
  }
  const artifact = JSON.parse(readFileSync(CONTRACT_ARTIFACT, 'utf8')) as { abi: unknown; bytecode: { object: Hex } };
  const account = privateKeyToAccount(submitterPrivateKey);
  const chainId = await createPublicClient({ transport: http(rpcUrl) }).getChainId();
  const chain = {
    id: chainId,
    name: 'ddn-local-reference',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const deployTxHash = await walletClient.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.object,
    args: [account.address],
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

export function assertDeployedContractMatchesTrustedProfile(deployed: DeployedDecisionAnchor, profile: TrustedDemoProfileV1): void {
  if (deployed.chainId !== profile.chain.chainId) {
    throw new DemoTrustProfileMismatchError(
      `deployed chainId ${deployed.chainId} does not match trusted profile chainId ${profile.chain.chainId} -- refusing to start the demo`
    );
  }
  if (deployed.contractAddress.toLowerCase() !== profile.chain.contractAddress.toLowerCase()) {
    throw new DemoTrustProfileMismatchError('deployed contract address does not match the trusted profile -- refusing to start the demo');
  }
}

export async function deployAndVerifyDecisionAnchor(
  rpcUrl: string,
  profile: TrustedDemoProfileV1,
  submitterPrivateKey: Hex
): Promise<Hex> {
  const deployed = await deployDecisionAnchor(rpcUrl, submitterPrivateKey);
  assertDeployedContractMatchesTrustedProfile(deployed, profile);
  return deployed.contractAddress;
}
