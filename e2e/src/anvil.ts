// SPDX-License-Identifier: Apache-2.0
import type { ChildProcess } from 'node:child_process';
import { chmod, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, http } from 'viem';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { killChildOnFailure, spawnManaged, type ManagedProcess } from './process-utils.js';

export interface RunningAnvil {
  readonly managedProcess: ManagedProcess;
  readonly rpcUrl: string;
  readonly port: number;
  readonly submitterPrivateKey: Hex;
}

async function waitForAnvilReady(child: ChildProcess, rpcUrl: string, getStderr: () => string): Promise<void> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`anvil exited early (code ${child.exitCode}) before it ever responded:\n${getStderr()}`);
    }
    try {
      await client.getBlockNumber();
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`anvil did not become reachable at ${rpcUrl} within 15s:\n${getStderr()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

/** Spawns a genuinely fresh Anvil node with a random mnemonic and no prior
 * state. The generated account's first transaction deploys
 * DecisionAnchor.sol at nonce 0; its address is discovered and injected
 * into the runtime trust profile instead of being committed. `--block-time
 * 1` makes Anvil mine a new block
 * every second on its own, rather than only on new transactions -- the
 * anchor worker needs real confirmation blocks to accrue *after* its
 * anchor transaction lands, and a real chain does that on its own too;
 * without this, confirmations would never accrue on an otherwise-idle
 * chain and the anchor would never reach CONFIRMED.
 *
 * spawnManaged(..., { detached: true }) plus killChildOnFailure (see
 * process-utils.ts): if anvil never becomes reachable, or fails to spawn
 * at all, the process is killed before this function's promise ever
 * rejects -- nothing is left running for a caller to have to remember to
 * clean up. */
export async function startFreshAnvil(port: number, tempDir: string): Promise<RunningAnvil> {
  const configPath = join(tempDir, 'anvil-runtime-config.json');
  const managedProcess = spawnManaged('anvil', ['--port', String(port), '--block-time', '1', '--mnemonic-random', '--config-out', configPath, '--silent'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  const rpcUrl = `http://127.0.0.1:${port}`;

  let stderr = '';
  managedProcess.process.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const submitterPrivateKey = await killChildOnFailure(managedProcess, async () => {
    await waitForAnvilReady(managedProcess.process, rpcUrl, () => stderr);
    try {
      // Anvil creates this inside the E2E run's owner-only temporary
      // directory. Tighten the file itself before reading any key material;
      // it is deleted immediately after the in-memory key is validated.
      await chmod(configPath, 0o600);
      const metadata = await stat(configPath);
      if ((metadata.mode & 0o077) !== 0) throw new Error('Anvil runtime config was not owner-only');
      const parsed = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
      const accounts = parsed.available_accounts;
      const privateKeys = parsed.private_keys;
      if (!Array.isArray(accounts) || !Array.isArray(privateKeys) || accounts.length === 0 || accounts.length !== privateKeys.length) {
        throw new Error('Anvil runtime config has an invalid account/key shape');
      }
      const address = accounts[0];
      const privateKey = privateKeys[0];
      if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Anvil runtime account is invalid');
      if (typeof privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('Anvil runtime private key is invalid');
      if (privateKeyToAccount(privateKey as Hex).address.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Anvil runtime account does not match its private key');
      }
      return privateKey as Hex;
    } finally {
      await rm(configPath, { force: true });
    }
  });

  return { managedProcess, rpcUrl, port, submitterPrivateKey };
}
