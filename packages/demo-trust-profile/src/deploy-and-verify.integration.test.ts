// SPDX-License-Identifier: Apache-2.0
// Real integration test against a local Anvil node -- proves the
// determinism claim in deploy-and-verify.ts actually holds (a fresh Anvil
// + the dev account's first deploy really does reproduce the committed
// TrustedDemoProfileV1's contractAddress) and that the fail-closed
// mismatch check actually rejects a wrong address/chainId rather than
// silently accepting it. Same DDN_ANCHOR_TEST_ANVIL discipline as
// apps/anchor-service's own chain-client.integration.test.ts: a plain
// local `pnpm test` just skips if anvil/forge build aren't available, but
// DDN_ANCHOR_TEST_ANVIL (set in the `contracts` CI job) fails loudly on a
// missing prerequisite instead of skipping quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DECISION_ANCHOR_ABI, sha256DigestToBytes32 } from '@ddn/receipt-sdk';
import type { Sha256Digest } from '@ddn/crypto';
import {
  contractArtifactExists,
  CONTRACT_ARTIFACT,
  assertDeployedContractMatchesTrustedProfile,
  DemoTrustProfileMismatchError,
} from './deploy-and-verify.js';
import {
  deployDecisionAnchorDeterministically,
  deployAndVerifyDecisionAnchor,
  DEMO_DEV_PRIVATE_KEY,
} from './test-fixtures/fixed-local-anvil-deploy.js';
import { loadBundledTrustedDemoProfile } from './load-profile.js';
import { createDemoChainReader } from './chain-reader.js';

const prerequisitesMet = contractArtifactExists();
const prerequisitesExplicitlyRequested = Boolean(process.env.DDN_ANCHOR_TEST_ANVIL);
if (prerequisitesExplicitlyRequested && !prerequisitesMet) {
  throw new Error(
    `DDN_ANCHOR_TEST_ANVIL was explicitly set but ${CONTRACT_ARTIFACT} does not exist -- run \`forge build\` in contracts/ first. Refusing to silently skip a check that was explicitly requested to run for real.`
  );
}

const ANVIL_PORT = 8648;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;

async function waitForAnvil(): Promise<void> {
  const client = createPublicClient({ transport: http(RPC_URL) });
  for (let i = 0; i < 50; i++) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error('anvil did not become ready in time');
}

test(
  'deployAndVerifyDecisionAnchor against a real, freshly reset local Anvil node',
  { skip: !prerequisitesMet && 'requires `forge build` in contracts/ and anvil (Foundry) on PATH' },
  async (t) => {
    let anvilProcess: ChildProcess;

    t.beforeEach(async () => {
      anvilProcess = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent'], { stdio: 'ignore' });
      await waitForAnvil();
    });

    t.afterEach(() => {
      anvilProcess?.kill();
    });

    await t.test('reproduces the committed TrustedDemoProfileV1 contractAddress and chainId exactly', async () => {
      const profile = loadBundledTrustedDemoProfile();
      const contractAddress = await deployAndVerifyDecisionAnchor(RPC_URL, profile);
      assert.equal(contractAddress.toLowerCase(), profile.chain.contractAddress.toLowerCase());
    });

    await t.test('fails closed on a chainId mismatch', async () => {
      const profile = loadBundledTrustedDemoProfile();
      const deployed = await deployDecisionAnchorDeterministically(RPC_URL);
      assert.throws(
        () => assertDeployedContractMatchesTrustedProfile({ ...deployed, chainId: deployed.chainId + 1 }, profile),
        DemoTrustProfileMismatchError
      );
    });

    await t.test('fails closed on a contractAddress mismatch', async () => {
      const profile = loadBundledTrustedDemoProfile();
      const deployed = await deployDecisionAnchorDeterministically(RPC_URL);
      const wrongAddress = `0x${'0'.repeat(40)}` as typeof deployed.contractAddress;
      assert.throws(
        () => assertDeployedContractMatchesTrustedProfile({ ...deployed, contractAddress: wrongAddress }, profile),
        DemoTrustProfileMismatchError
      );
    });

    await t.test('createDemoChainReader reads back a batch anchored on the deployed contract', async () => {
      const profile = loadBundledTrustedDemoProfile();
      await deployAndVerifyDecisionAnchor(RPC_URL, profile);

      const account = privateKeyToAccount(DEMO_DEV_PRIVATE_KEY);
      const chain = {
        id: profile.chain.chainId,
        name: 'ddn-demo-test',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
      };
      const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });
      const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

      const batchId = ('sha256:' + 'aa'.repeat(32)) as Sha256Digest;
      const merkleRoot = ('sha256:' + 'bb'.repeat(32)) as Sha256Digest;
      const txHash = await walletClient.writeContract({
        address: profile.chain.contractAddress as `0x${string}`,
        abi: DECISION_ANCHOR_ABI,
        functionName: 'anchorBatch',
        args: [sha256DigestToBytes32(batchId), sha256DigestToBytes32(merkleRoot), 3n],
      } as never);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const reader = createDemoChainReader(RPC_URL, profile);
      assert.equal(reader.chainId, profile.chain.chainId);
      assert.equal(reader.contractAddress, profile.chain.contractAddress);
      const batch = await reader.getBatch(batchId);
      assert.equal(batch.merkleRoot, merkleRoot);
      assert.equal(batch.decisionCount, 3);
    });
  }
);
