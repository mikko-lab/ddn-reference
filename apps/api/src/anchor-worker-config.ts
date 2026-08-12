// SPDX-License-Identifier: Apache-2.0
// Milestone 6: boot-time config for the in-process anchor worker,
// deliberately separate from ApiConfig -- anchoring needs a real (or local
// Anvil) chain and a deployed DecisionAnchor.sol, which most apps/api
// boots (local dev without Anvil running, most CI jobs) don't have and
// shouldn't need just to serve decisions/receipts/policies. Anchoring is
// optional infrastructure, not a hard requirement, matching ADR-001's
// "anchoring is decoupled from decision finality."

export interface AnchorWorkerBootConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly contractAddress: `0x${string}`;
  readonly submitterPrivateKey: `0x${string}`;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly confirmationBlocks: number;
}

const REQUIRED_KEYS = ['DDN_ANCHOR_RPC_URL', 'DDN_ANCHOR_CHAIN_ID', 'DDN_ANCHOR_CONTRACT_ADDRESS', 'DDN_ANCHOR_SUBMITTER_PRIVATE_KEY'] as const;

function parsePositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

/**
 * Returns undefined if anchoring isn't configured for this boot at all --
 * none of the required env vars are set. Throws if only SOME are set: a
 * genuine misconfiguration, not something to silently guess around, same
 * "fail loudly, no partial defaults" discipline config.ts uses for
 * ApiConfig's own required fields.
 */
export function loadAnchorWorkerBootConfig(env: NodeJS.ProcessEnv): AnchorWorkerBootConfig | undefined {
  const present = REQUIRED_KEYS.filter((key) => env[key] !== undefined && env[key] !== '');
  if (present.length === 0) return undefined;
  if (present.length !== REQUIRED_KEYS.length) {
    const missing = REQUIRED_KEYS.filter((key) => !present.includes(key));
    throw new Error(`anchor worker config is partially set -- missing: ${missing.join(', ')}. Set all of ${REQUIRED_KEYS.join(', ')}, or none, to boot without anchoring.`);
  }

  const chainId = Number.parseInt(env.DDN_ANCHOR_CHAIN_ID!, 10);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`DDN_ANCHOR_CHAIN_ID must be a positive integer, got: ${env.DDN_ANCHOR_CHAIN_ID}`);
  }
  const contractAddress = env.DDN_ANCHOR_CONTRACT_ADDRESS!;
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error('DDN_ANCHOR_CONTRACT_ADDRESS must be a 0x-prefixed 20-byte address');
  }
  const submitterPrivateKey = env.DDN_ANCHOR_SUBMITTER_PRIVATE_KEY!;
  if (!/^0x[0-9a-fA-F]{64}$/.test(submitterPrivateKey)) {
    throw new Error('DDN_ANCHOR_SUBMITTER_PRIVATE_KEY must be a 0x-prefixed 32-byte private key');
  }

  return {
    rpcUrl: env.DDN_ANCHOR_RPC_URL!,
    chainId,
    contractAddress: contractAddress as `0x${string}`,
    submitterPrivateKey: submitterPrivateKey as `0x${string}`,
    pollIntervalMs: parsePositiveInt(env, 'DDN_ANCHOR_POLL_INTERVAL_MS', 5_000),
    batchSize: parsePositiveInt(env, 'DDN_ANCHOR_BATCH_SIZE', 50),
    confirmationBlocks: parsePositiveInt(env, 'DDN_ANCHOR_CONFIRMATION_BLOCKS', 2),
  };
}
