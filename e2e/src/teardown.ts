// SPDX-License-Identifier: Apache-2.0
import { rm } from 'node:fs/promises';
import type { RunningAnvil } from './anvil.js';
import type { RunningApi } from './api-process.js';
import type { RunningNextApp } from './next-app-process.js';
import { killAndWait, type KillOutcome } from './process-utils.js';

export interface TeardownState {
  anvil?: RunningAnvil;
  api?: RunningApi;
  explorer?: RunningNextApp;
  demoReference?: RunningNextApp;
  tempDir?: string;
}

/** Cleans up whatever subset of the real stack actually got started --
 * every field is optional and checked independently, so this is safe to
 * call after a failure at ANY point in run-e2e.ts's startup sequence, not
 * just once everything came up (e.g. Anvil and apps/api started but
 * apps/demo-negotiation-reference's build failed -- `state.explorer`/
 * `state.demoReference` are simply never set, and this still tears down
 * the two that did start). Uses Promise.allSettled so one process
 * failing to die doesn't stop the others from being attempted, and
 * reports (rather than throws on) any cleanup failure -- teardown's job
 * is to clean up as much as it can, not to be one more thing that can
 * fail the run. killAndWait itself is unconditionally bounded (see
 * process-utils.ts), so this never hangs waiting on a stuck process --
 * a 'timed-out' outcome is reported the same way a rejection is, not
 * silently treated as success.
 *
 * This only ever handles processes that successfully started AND were
 * recorded into `state` by run-e2e.ts's own sequencing -- a process that
 * failed its OWN readiness check before that point is killed by
 * killChildOnFailure (process-utils.ts) inside its own startXxx()
 * function instead, since it never gets a handle into `state` at all. */
export async function teardown(state: TeardownState): Promise<void> {
  const alreadyExited: Promise<KillOutcome> = Promise.resolve('already-exited');
  const results = await Promise.allSettled([
    state.demoReference ? killAndWait(state.demoReference.managedProcess) : alreadyExited,
    state.explorer ? killAndWait(state.explorer.managedProcess) : alreadyExited,
    state.api ? killAndWait(state.api.managedProcess) : alreadyExited,
    state.anvil ? killAndWait(state.anvil.managedProcess) : alreadyExited,
  ]);
  if (state.tempDir) {
    await rm(state.tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('cleanup warning:', result.reason);
    } else if (result.value === 'timed-out') {
      console.error('cleanup warning: a process did not exit even after SIGKILL within the timeout -- it may still be running');
    }
  }
}
