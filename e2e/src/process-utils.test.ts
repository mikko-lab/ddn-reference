// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { killAndWait, killChildOnFailure, spawnManaged, type ManagedProcess } from './process-utils.js';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // A signalled orphan can briefly remain as a zombie until the OS reaps
    // it. Such a process has exited and holds no ports or other runtime
    // resources, even though kill(pid, 0) still succeeds for its PID.
    const state = execFileSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return state.length > 0 && !state.startsWith('Z');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForPidToStop(pid: number, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return !isPidAlive(pid);
}

/** A free, unused TCP port to bind test-only listeners on -- distinct
 * from any port the real orchestration uses, so these tests can never
 * collide with a real run. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not determine a free port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function spawnLongRunning(detached: boolean): ManagedProcess {
  return spawnManaged(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached });
}

/** Spawns a real child that spawns a real grandchild (never detached
 * itself, so it inherits the parent's process group) and prints the
 * grandchild's pid on its first stdout line -- used to prove killAndWait
 * reaches descendants, not just the immediate process. */
function spawnWithGrandchild(): ManagedProcess {
  const script = `
    const { spawn } = require('child_process');
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    console.log('grandchild-pid:' + grandchild.pid);
    setInterval(() => {}, 1000);
  `;
  return spawnManaged(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
}

test('killAndWait terminates a process and its process-group descendant', async () => {
  const managed = spawnWithGrandchild();
  let grandchildPid = -1;
  await new Promise<void>((resolve) => {
    managed.process.stdout?.on('data', (chunk: Buffer) => {
      const match = /grandchild-pid:(\d+)/.exec(chunk.toString('utf8'));
      if (match?.[1]) {
        grandchildPid = Number(match[1]);
        resolve();
      }
    });
  });
  assert.ok(managed.process.pid !== undefined);
  assert.ok(isPidAlive(managed.process.pid));
  assert.ok(isPidAlive(grandchildPid));

  const outcome = await killAndWait(managed);

  assert.equal(outcome, 'exited');
  assert.equal(isPidAlive(managed.process.pid), false, 'the spawned process itself must be dead');
  assert.equal(
    await waitForPidToStop(grandchildPid),
    true,
    'the process-group descendant must stop too, not just the immediate process'
  );
});

test('killAndWait resolves immediately (does not hang) for a process that already exited', async () => {
  const managed = spawnManaged(process.execPath, ['-e', 'process.exit(0)'], { detached: false });
  await new Promise((resolve) => managed.process.once('exit', resolve));
  const start = Date.now();
  const outcome = await killAndWait(managed);
  assert.equal(outcome, 'already-exited');
  assert.ok(Date.now() - start < 500, 'killAndWait should return promptly for an already-exited process, not wait out its own timeout');
});

test('killAndWait signals a non-detached process directly (child.kill), never via a negative PID', async () => {
  const managed = spawnLongRunning(false);
  assert.equal(managed.allowGroupSignal, false);
  assert.ok(managed.process.pid !== undefined);
  assert.ok(isPidAlive(managed.process.pid));

  const outcome = await killAndWait(managed);

  assert.equal(outcome, 'exited');
  assert.equal(isPidAlive(managed.process.pid), false, 'a non-detached process must still be killed, just via the direct child.kill path, not group-signaling');
});

test('killAndWait signals a detached process via its process group', async () => {
  const managed = spawnLongRunning(true);
  assert.equal(managed.allowGroupSignal, true);
  assert.ok(managed.process.pid !== undefined);

  const outcome = await killAndWait(managed);

  assert.equal(outcome, 'exited');
  assert.equal(isPidAlive(managed.process.pid!), false);
});

test('killAndWait reports "timed-out" (and never hangs) when the process never exits, even after escalating to SIGKILL', async () => {
  // A process that ignores SIGTERM AND SIGKILL is not something a real
  // OS process can do -- SIGKILL is unblockable -- so this simulates the
  // one thing that actually IS reachable from user space: this process
  // is `allowGroupSignal: true`, so signalOnce only ever calls the
  // global `process.kill(-pid, signal)`, never `child.kill()` directly
  // (see process-utils.ts) -- stubbing just that one call site makes
  // every signal this test sends a no-op, so neither the SIGTERM nor the
  // SIGKILL escalation step ever actually reaches the real process. This
  // is exactly the shape of the real-world edge case (a process stuck in
  // an uninterruptible wait, immune to signals for a while) without
  // needing to genuinely wedge a process in kernel space to prove it.
  const managed = spawnLongRunning(true);
  const originalProcessKill = process.kill;
  process.kill = ((pid: number, signal?: string | number) => {
    if (pid === -managed.process.pid!) return true;
    return originalProcessKill(pid, signal);
  }) as typeof process.kill;

  try {
    const start = Date.now();
    const outcome = await killAndWait(managed, 'SIGTERM', 200);
    const elapsed = Date.now() - start;

    assert.equal(outcome, 'timed-out', 'must report timed-out rather than hanging or falsely claiming success');
    // Bounded at roughly 2 * timeoutMs (SIGTERM wait + SIGKILL wait) --
    // proves this returned on its own timeout, not by coincidence.
    assert.ok(elapsed < 2_000, `expected killAndWait to give up within ~2*timeoutMs, took ${elapsed}ms`);
  } finally {
    process.kill = originalProcessKill;
    // The process is still genuinely running (that was the whole
    // premise) -- clean it up for real, bypassing the stubbed .kill.
    originalProcessKill(-managed.process.pid!, 'SIGKILL');
  }
});

test('killChildOnFailure kills the spawned process when work() rejects, and rethrows the original error', async () => {
  const managed = spawnLongRunning(true);
  const pid = managed.process.pid;
  assert.ok(pid !== undefined);
  assert.ok(isPidAlive(pid));

  await assert.rejects(
    () => killChildOnFailure(managed, () => Promise.reject(new Error('simulated readiness timeout'))),
    /simulated readiness timeout/
  );

  assert.equal(isPidAlive(pid), false, 'killChildOnFailure must kill the process before its own promise rejects -- this is exactly the process-leak this function exists to close');
});

test('killChildOnFailure removes its own "error" listener once the race settles on the FAILURE path', async () => {
  const managed = spawnLongRunning(true);
  const before = managed.process.listenerCount('error');

  await assert.rejects(() => killChildOnFailure(managed, () => Promise.reject(new Error('simulated timeout'))));

  assert.equal(managed.process.listenerCount('error'), before, 'the spawnError listener must be removed after the race settles, not left attached to a (now-dead) process');
});

test('killChildOnFailure removes its own "error" listener once the race settles on the SUCCESS path', async () => {
  const managed = spawnLongRunning(true);
  const before = managed.process.listenerCount('error');

  const result = await killChildOnFailure(managed, () => Promise.resolve('ready'));

  assert.equal(result, 'ready');
  assert.equal(
    managed.process.listenerCount('error'),
    before,
    'a successful readiness check must not leave the spawnError listener (and its never-settling promise) dangling on the still-running process'
  );

  await killAndWait(managed);
});

test('killChildOnFailure frees the port a process was holding once work() rejects', async () => {
  const port = await getFreePort();
  // net.Server#listen() is asynchronous -- a bare try/catch around it
  // never observes an EADDRINUSE failure, since nothing throws
  // synchronously. The child prints its own "listening" line only once
  // the server's real 'listening' event fires, so waiting for that line
  // (rather than racing a probe connection against the child's own
  // startup) is what actually proves the port is held before this test
  // simulates a failure and checks it gets released.
  const managed = spawnManaged(
    process.execPath,
    ['-e', `const s = require('net').createServer(); s.listen(${port}, '127.0.0.1', () => console.log('listening'));`],
    { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  await new Promise<void>((resolve) => {
    managed.process.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes('listening')) resolve();
    });
  });

  await assert.rejects(() => killChildOnFailure(managed, () => Promise.reject(new Error('simulated timeout'))));

  // The port must be bindable again immediately after -- proving the OS
  // actually released it, not just that the process object reports dead.
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve());
    });
  });
});

test('killChildOnFailure surfaces a spawn error as a rejected promise, not an uncaught exception', async () => {
  // A command that cannot possibly exist -- spawn() itself succeeds
  // (returns a ChildProcess synchronously) but the OS reports ENOENT
  // asynchronously via the child's own 'error' event, exactly the path
  // that used to `throw` directly inside that event's callback.
  const managed = spawnManaged('this-command-definitely-does-not-exist-ddn-e2e-test', [], { detached: false });
  const neverResolves = new Promise<never>(() => {
    /* work() that would hang forever if killChildOnFailure didn't race it against the spawn error */
  });

  await assert.rejects(() => killChildOnFailure(managed, () => neverResolves), /ENOENT|not exist/i);
  // Reaching this line at all (rather than the test process crashing
  // with an uncaught exception before assert.rejects ever gets to run)
  // is itself the proof: the old `child.on('error', (e) => { throw ... })`
  // pattern this replaces would have crashed the process instead of
  // producing a promise assert.rejects could observe.
});

test('killChildOnFailure leaves the process running and returns the value on success', async () => {
  const managed = spawnLongRunning(true);
  const pid = managed.process.pid;
  assert.ok(pid !== undefined);

  const result = await killChildOnFailure(managed, () => Promise.resolve('ready'));

  assert.equal(result, 'ready');
  assert.ok(isPidAlive(pid), 'a successful readiness check must never kill the process -- cleanup for the success path is the caller\'s own job');

  await killAndWait(managed);
});
