// SPDX-License-Identifier: Apache-2.0
// TEST-ONLY / NEVER USE IN PRODUCTION.
//
// Real integration test against a local Anvil node -- the chain-boundary
// code (bytes32 conversion, ABI encoding, event log parsing, the
// BatchAlreadyAnchored retry path) is exactly the part most likely to have
// bugs a purely mocked test would miss. Matches Milestone 5's own
// "real E2E, not mocked" precedent for the acceptance-critical path.
//
// Requires `forge build` in contracts/ (so contracts/out/DecisionAnchor.sol/
// DecisionAnchor.json exists) and `anvil` (Foundry) on PATH.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Sha256Digest } from '@ddn/crypto';
import { AnchorChainClient } from './chain-client.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRACT_ARTIFACT = join(REPO_ROOT, 'contracts/out/DecisionAnchor.sol/DecisionAnchor.json');

const prerequisitesMet = existsSync(CONTRACT_ARTIFACT);
// DDN_ANCHOR_TEST_ANVIL lets CI mark this as explicitly required to run
// for real (the contracts CI job, which already installs Foundry) --
// missing prerequisites there must fail loudly, not skip quietly, the same
// discipline apps/coordinator's decide.test.ts uses for the validator
// binary. A plain local `pnpm test` with neither `forge build` nor anvil
// available just skips.
const prerequisitesExplicitlyRequested = Boolean(process.env.DDN_ANCHOR_TEST_ANVIL);
if (prerequisitesExplicitlyRequested && !prerequisitesMet) {
  throw new Error(
    `DDN_ANCHOR_TEST_ANVIL was explicitly set but ${CONTRACT_ARTIFACT} does not exist -- run \`forge build\` in contracts/ first. Refusing to silently skip a check that was explicitly requested to run for real.`
  );
}

// Anvil's well-known, publicly documented default dev account (mnemonic
// "test test test test test test test test test test test junk", account
// #0) -- never a real secret, standard practice for local-chain testing.
const DEV_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEV_ADDRESS: Hex = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const ANVIL_PORT = 8646;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CHAIN_ID = 31337;

function sha(byte: string): Sha256Digest {
  return `sha256:${byte.repeat(32)}` as Sha256Digest;
}

async function waitForAnvil(): Promise<void> {
  const client = createPublicClient({ transport: http(RPC_URL) });
  for (let i = 0; i < 50; i++) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('anvil did not become ready in time');
}

async function deployDecisionAnchor(): Promise<Hex> {
  const artifact = JSON.parse(readFileSync(CONTRACT_ARTIFACT, 'utf8')) as { abi: unknown; bytecode: { object: Hex } };
  const account = privateKeyToAccount(DEV_PRIVATE_KEY);
  const chain = {
    id: CHAIN_ID,
    name: 'ddn-anchor-test',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };
  const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

  const deployTxHash = await walletClient.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode.object,
    args: [DEV_ADDRESS],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
  if (!receipt.contractAddress) throw new Error('deployment did not produce a contract address');
  return receipt.contractAddress;
}

test(
  'AnchorChainClient against a real local Anvil node',
  { skip: !prerequisitesMet && 'requires `forge build` in contracts/ and anvil (Foundry) on PATH' },
  async (t) => {
    let anvilProcess: ChildProcess;
    let contractAddress: Hex;

    t.before(async () => {
      anvilProcess = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent'], { stdio: 'ignore' });
      await waitForAnvil();
      contractAddress = await deployDecisionAnchor();
    });

    t.after(() => {
      anvilProcess?.kill();
    });

    await t.test('submitAnchorBatch + getBatch round-trip', async () => {
      const client = new AnchorChainClient({ rpcUrl: RPC_URL, chainId: CHAIN_ID, contractAddress, submitterPrivateKey: DEV_PRIVATE_KEY });
      const batchId = sha('a1');
      const merkleRoot = sha('b2');
      const { txHash } = await client.submitAnchorBatch(batchId, merkleRoot, 3);
      assert.ok(txHash.startsWith('0x'));

      const batch = await client.getBatch(batchId);
      assert.equal(batch.merkleRoot, merkleRoot);
      assert.equal(batch.decisionCount, 3);
    });

    await t.test('exact-match resubmission is treated as a successful idempotent retry, recovering the original tx', async () => {
      const client = new AnchorChainClient({ rpcUrl: RPC_URL, chainId: CHAIN_ID, contractAddress, submitterPrivateKey: DEV_PRIVATE_KEY });
      const batchId = sha('c3');
      const merkleRoot = sha('d4');
      const first = await client.submitAnchorBatch(batchId, merkleRoot, 2);
      const second = await client.submitAnchorBatch(batchId, merkleRoot, 2);
      assert.equal(second.txHash, first.txHash);

      const event = await client.findAnchoredEvent(batchId);
      assert.equal(event?.txHash, first.txHash);
    });

    await t.test('conflicting-content resubmission of the same batchId fails closed', async () => {
      const client = new AnchorChainClient({ rpcUrl: RPC_URL, chainId: CHAIN_ID, contractAddress, submitterPrivateKey: DEV_PRIVATE_KEY });
      const batchId = sha('e5');
      await client.submitAnchorBatch(batchId, sha('f6'), 4);
      await assert.rejects(() => client.submitAnchorBatch(batchId, sha('99'), 4), /conflicting content/);
    });

    await t.test('getTransactionOutcome/getBlockNumber/getBlock report real chain state', async () => {
      const client = new AnchorChainClient({ rpcUrl: RPC_URL, chainId: CHAIN_ID, contractAddress, submitterPrivateKey: DEV_PRIVATE_KEY });
      const { txHash } = await client.submitAnchorBatch(sha('11'), sha('22'), 1);
      const outcome = await client.getTransactionOutcome(txHash);
      assert.equal(outcome?.status, 'success');
      const currentBlockNumber = await client.getBlockNumber();
      assert.ok(currentBlockNumber >= outcome!.blockNumber);
      const block = await client.getBlock(outcome!.blockNumber);
      assert.equal(block.hash, outcome!.blockHash);
    });

    await t.test('getTransactionOutcome returns null for an unmined hash', async () => {
      const client = new AnchorChainClient({ rpcUrl: RPC_URL, chainId: CHAIN_ID, contractAddress, submitterPrivateKey: DEV_PRIVATE_KEY });
      const outcome = await client.getTransactionOutcome(('0x' + '0'.repeat(64)) as Hex);
      assert.equal(outcome, null);
    });

    await t.test('getTransactionOutcome propagates a genuine RPC/transport error rather than returning null', async () => {
      // Port 1 is a reserved, essentially never-listening port -- this
      // triggers a real connection-refused/transport failure, distinct
      // from viem's TransactionReceiptNotFoundError (which is what a
      // genuinely unmined hash produces, tested above).
      const unreachableClient = new AnchorChainClient({
        rpcUrl: 'http://127.0.0.1:1',
        chainId: CHAIN_ID,
        contractAddress,
        submitterPrivateKey: DEV_PRIVATE_KEY,
      });
      await assert.rejects(() => unreachableClient.getTransactionOutcome(('0x' + '1'.repeat(64)) as Hex));
    });
  }
);
