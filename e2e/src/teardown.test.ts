// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { spawnManaged, type ManagedProcess } from './process-utils.js';
import { teardown, type TeardownState } from './teardown.js';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function spawnLongRunning(): ManagedProcess {
  return spawnManaged(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true });
}

const TEST_ONLY_PLACEHOLDER_KEY = `0x${'00'.repeat(32)}` as Hex;

test('teardown cleans up a fully-started stack (all four process slots plus the temp dir)', async () => {
  const anvil = spawnLongRunning();
  const api = spawnLongRunning();
  const explorer = spawnLongRunning();
  const demoReference = spawnLongRunning();
  const tempDir = await mkdtemp(join(tmpdir(), 'ddn-e2e-teardown-test-'));
  await writeFile(join(tempDir, 'validator-set.json'), '{}');

  const state: TeardownState = {
    anvil: { managedProcess: anvil, rpcUrl: 'http://127.0.0.1:0', port: 0, submitterPrivateKey: TEST_ONLY_PLACEHOLDER_KEY },
    api: { managedProcess: api, baseUrl: 'http://127.0.0.1:0' },
    explorer: { managedProcess: explorer, baseUrl: 'http://localhost:0' },
    demoReference: { managedProcess: demoReference, baseUrl: 'http://localhost:0' },
    tempDir,
  };

  await teardown(state);

  assert.equal(isPidAlive(anvil.process.pid!), false);
  assert.equal(isPidAlive(api.process.pid!), false);
  assert.equal(isPidAlive(explorer.process.pid!), false);
  assert.equal(isPidAlive(demoReference.process.pid!), false);
  assert.equal(existsSync(tempDir), false, 'the temp key-file/validator-set directory must be removed');
});

// Mirrors a real failure mode: run-e2e.ts's own sequencing means a
// failure partway through (e.g. apps/demo-negotiation-reference's `next build`
// throwing) leaves later fields (explorer, demoReference) simply never
// assigned on `state` at all -- teardown() must not assume every field
// is present.
test('teardown cleans up a partially-started stack -- only some fields set, others left undefined', async () => {
  const anvil = spawnLongRunning();
  const api = spawnLongRunning();
  const tempDir = await mkdtemp(join(tmpdir(), 'ddn-e2e-teardown-test-'));

  const state: TeardownState = {
    anvil: { managedProcess: anvil, rpcUrl: 'http://127.0.0.1:0', port: 0, submitterPrivateKey: TEST_ONLY_PLACEHOLDER_KEY },
    api: { managedProcess: api, baseUrl: 'http://127.0.0.1:0' },
    tempDir,
    // explorer and demoReference deliberately omitted -- never started
  };

  await teardown(state);

  assert.equal(isPidAlive(anvil.process.pid!), false);
  assert.equal(isPidAlive(api.process.pid!), false);
  assert.equal(existsSync(tempDir), false);
});

test('teardown on a completely empty state (nothing ever started) resolves without throwing', async () => {
  await teardown({});
});

test('teardown tolerates a tempDir that was already removed (does not throw)', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ddn-e2e-teardown-test-'));
  await teardown({ tempDir });
  // Calling teardown again for the same (now already-removed) tempDir
  // must not throw -- matches rm's own { force: true } behavior.
  await teardown({ tempDir });
  assert.equal(existsSync(tempDir), false);
});

test('teardown reports (does not throw, does not hang) when a process times out even after SIGKILL', async () => {
  const stuck = spawnLongRunning();
  const originalProcessKill = process.kill;
  process.kill = ((pid: number, signal?: string | number) => {
    if (pid === -stuck.process.pid!) return true;
    return originalProcessKill(pid, signal);
  }) as typeof process.kill;

  const originalConsoleError = console.error;
  const loggedMessages: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedMessages.push(args);
  };

  try {
    const start = Date.now();
    await teardown({ api: { managedProcess: stuck, baseUrl: 'http://127.0.0.1:0' } });
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 15_000, `teardown must not hang on a stuck process, took ${elapsed}ms`);
    assert.ok(
      loggedMessages.some((args) => args.some((a) => typeof a === 'string' && a.includes('did not exit even after SIGKILL'))),
      'teardown must report the timed-out process, not silently treat it as cleaned up'
    );
  } finally {
    console.error = originalConsoleError;
    process.kill = originalProcessKill;
    originalProcessKill(-stuck.process.pid!, 'SIGKILL');
  }
});
