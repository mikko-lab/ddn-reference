// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/** Polls a URL with plain GET until it responds with any HTTP status (not
 * necessarily 200 -- some readiness probes, like a login page, return 200
 * for "ready" but others might legitimately 503 while still meaning "the
 * process is up and answering," which is enough for a liveness wait) or
 * the timeout elapses. `acceptStatus` narrows that when a specific status
 * actually matters. */
export async function waitForHttp(url: string, options: { readonly timeoutMs: number; readonly acceptStatus?: (status: number) => boolean }): Promise<void> {
  const acceptStatus = options.acceptStatus ?? (() => true);
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const response = await fetch(url);
      if (acceptStatus(response.status)) return;
      lastError = new Error(`unexpected status ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`${url} did not become ready within ${options.timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** A spawned child process paired with an explicit, caller-declared record
 * of whether it is safe to signal its whole process GROUP (negative-PID
 * `process.kill(-pid, signal)`) rather than just the one process. This is
 * never inferred from `child.pid`, from whether a group-signal attempt
 * happens to succeed or fail, or from any other incidental detail --
 * `allowGroupSignal` is set once, at spawn time, by spawnManaged, from the
 * exact `detached` flag the caller passed to `spawn()` itself. A process
 * spawned without `detached: true` is never a process-group leader (its
 * real group is inherited from its own parent), so signaling `-pid` for it
 * would target an arbitrary, unrelated group id -- `allowGroupSignal:
 * false` means that path is never even attempted for it; only
 * `child.kill(signal)` (the single, immediate process) is ever used. */
export interface ManagedProcess {
  readonly process: ChildProcess;
  readonly allowGroupSignal: boolean;
}

/** The one place `detached` is decided and recorded -- every real spawn
 * in this package goes through this function instead of calling
 * node:child_process's `spawn` directly, so `allowGroupSignal` can never
 * drift out of sync with the actual spawn options. */
export function spawnManaged(command: string, args: readonly string[], options: SpawnOptions & { readonly detached: boolean }): ManagedProcess {
  const process = spawn(command, args, options);
  return { process, allowGroupSignal: options.detached === true };
}

/** Signals `managed`'s process -- its whole process GROUP if
 * `allowGroupSignal` is true (reaching anything it spawned itself, e.g.
 * `pnpm exec next start`'s own next-server child, not just the immediate
 * process), or just the one process otherwise. No fallback between the
 * two paths: a group-signal failure (e.g. the process already exited) is
 * swallowed here exactly like a direct-signal failure would be --
 * cleanup is best-effort against a process that may already be gone,
 * never a reason to throw. */
function signalOnce(managed: ManagedProcess, signal: NodeJS.Signals): void {
  const { process: child, allowGroupSignal } = managed;
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (allowGroupSignal) {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    /* already exited, or the signal otherwise couldn't be delivered --
     * either way, not an error worth surfacing from a cleanup path. */
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** What killAndWait actually managed to confirm -- never silently reports
 * a process dead without evidence. 'timed-out' is a real, reportable
 * outcome (not a thrown error) precisely so a caller like teardown() can
 * log it and move on to cleaning up everything else, rather than either
 * hanging forever waiting for an 'exit' that may never come, or lying
 * that the process is gone when it might not be. */
export type KillOutcome = 'already-exited' | 'exited' | 'timed-out';

/** Kills `managed`'s process (SIGTERM, escalating to SIGKILL) and waits
 * for it to actually exit -- a plain `.kill()` returns immediately, which
 * would let cleanup race ahead of the OS actually freeing the port the
 * next run needs. Bounded unconditionally: at most `timeoutMs` waiting
 * after SIGTERM, then at most another `timeoutMs` after SIGKILL, then
 * this returns 'timed-out' rather than waiting indefinitely -- SIGKILL
 * cannot be caught or ignored by a normal process, but a process stuck in
 * an uninterruptible kernel wait (blocked I/O) can in principle outlive
 * it, and this function must never let that hang the caller forever.
 *
 * Used both by run-e2e.ts's own teardown() for successfully-started
 * processes and by killChildOnFailure below for a process that failed
 * its own readiness check before ever being returned to a caller --
 * cleanup must not depend on the caller having captured a handle to it
 * first. */
export async function killAndWait(managed: ManagedProcess, signal: NodeJS.Signals = 'SIGTERM', timeoutMs = 5_000): Promise<KillOutcome> {
  const { process: child } = managed;
  if (child.exitCode !== null || child.signalCode !== null) return 'already-exited';

  signalOnce(managed, signal);
  if (await waitForExit(child, timeoutMs)) return 'exited';

  signalOnce(managed, 'SIGKILL');
  if (await waitForExit(child, timeoutMs)) return 'exited';

  return 'timed-out';
}

/** Runs `work` (typically a readiness wait against an already-spawned
 * child process) and guarantees the process is killed before any failure
 * ever propagates to the caller -- whether `work` itself rejects (e.g. a
 * readiness timeout) or the child emits its own 'error' event (e.g.
 * ENOENT if the binary disappears between a preflight check and the
 * actual spawn). Exception-safe by construction: the process is never
 * left running past this function's own return/throw, so a caller never
 * needs to have captured/stored the process handle anywhere for it to be
 * cleaned up -- unlike a bare `child.kill()` in the caller's own
 * catch block, which only ever runs if the caller remembered to add it,
 * and never at all for a process that failed before the caller received
 * a handle to it.
 *
 * A child process's 'error' event is normally just an EventEmitter
 * callback, not a promise -- an ENOENT/EACCES spawn failure delivered
 * that way would throw inside the event handler and become an uncaught
 * exception at the process level, invisible to any surrounding
 * try/catch or `await`. Wrapping it in `spawnError` here converts it
 * into an ordinary rejected promise that `Promise.race` (and therefore
 * every normal async control-flow construct, including a caller's own
 * try/finally) can see and handle like any other failure. The listener
 * backing that promise is always removed once the race settles --
 * whichever side wins -- via the outer `finally`, so a successful
 * readiness check never leaves a dangling 'error' listener (or its
 * never-settling promise) attached to the still-running process.
 *
 * On success, `child` is left running and untouched -- cleanup for the
 * success path is the caller's own responsibility, exactly as before. */
export async function killChildOnFailure<T>(managed: ManagedProcess, work: () => Promise<T>): Promise<T> {
  const child = managed.process;
  let errorHandler: ((error: unknown) => void) | undefined;
  const spawnError = new Promise<never>((_, reject) => {
    errorHandler = (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)));
    child.once('error', errorHandler);
  });
  try {
    return await Promise.race([spawnError, work()]);
  } catch (error) {
    await killAndWait(managed);
    throw error;
  } finally {
    if (errorHandler) child.off('error', errorHandler);
  }
}
