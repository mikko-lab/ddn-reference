// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { killChildOnFailure, spawnManaged, waitForHttp, type ManagedProcess } from './process-utils.js';

/** Runs `next build` (Turbopack production build) for the given app
 * directory and env -- synchronously, since nothing can start the server
 * before the build finishes. Throws with the full build output on
 * failure rather than letting a broken build surface later as a
 * confusing "server never became ready." Real production builds only:
 * this repo has hit multiple Turbopack bugs that only reproduce under
 * `next build && next start`, never `next dev` (see apps/explorer's own
 * playwright.config.ts and packages/schemas' import.meta.url fix). */
export function buildNextApp(appDir: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync('pnpm', ['exec', 'next', 'build'], { cwd: appDir, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`\`next build\` failed in ${appDir} (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}

export interface RunningNextApp {
  readonly managedProcess: ManagedProcess;
  readonly baseUrl: string;
}

/** Starts an already-built Next.js app's production server and waits for
 * it to actually answer GET / -- a real `next start`, not `next dev`. */
export async function startNextApp(appDir: string, port: number, env: NodeJS.ProcessEnv): Promise<RunningNextApp> {
  // `localhost`, not `127.0.0.1`: confirmed by hand that `next start`'s
  // built-in server always resolves a Route Handler's own `request.url`
  // authority to `http://localhost:<port>` regardless of `-H`/actual bind
  // address or the real Host header sent. apps/demo-negotiation-reference's /api/offer
  // abuse-hardened route compares the browser's real
  // `Origin` header against exactly that `new URL(request.url).origin` in
  // production -- Playwright's browser must actually navigate to
  // `localhost` too, or every same-origin form submission would be
  // rejected as cross-origin.
  const baseUrl = `http://localhost:${port}`;
  // spawnManaged(..., { detached: true }) plus killChildOnFailure (see
  // process-utils.ts): if the server never becomes reachable, the process
  // (and its own `next start` process-group descendants) is killed before
  // this function's promise ever rejects -- nothing is left running
  // holding the port for a caller to have to remember to clean up.
  const managedProcess = spawnManaged('pnpm', ['exec', 'next', 'start', '-p', String(port)], {
    cwd: appDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  managedProcess.process.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  managedProcess.process.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));

  try {
    await killChildOnFailure(managedProcess, () => waitForHttp(baseUrl, { timeoutMs: 30_000 }));
  } catch (error) {
    throw new Error(`${appDir}'s production server never became reachable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}\n--- process output ---\n${output}`);
  }

  return { managedProcess, baseUrl };
}
