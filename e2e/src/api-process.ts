// SPDX-License-Identifier: Apache-2.0
import { API_APP_DIR, API_SERVER_ENTRYPOINT, EXECUTION_PROFILE_PATH, POLICY_REGISTRY_PATH, VALIDATOR_BINARY_PATH } from './paths.js';
import { killChildOnFailure, spawnManaged, waitForHttp, type ManagedProcess } from './process-utils.js';
import type { ValidatorInstancePaths } from './validator-keys.js';

export interface ServiceTokenSpec {
  readonly token: string;
  readonly tokenId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
}

export interface AnchorWorkerSpec {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly submitterPrivateKey: string;
}

export interface StartRealApiOptions {
  readonly port: number;
  readonly validatorSetPath: string;
  readonly validatorInstances: readonly ValidatorInstancePaths[];
  readonly serviceTokens: readonly ServiceTokenSpec[];
  readonly corsAllowedOrigins: readonly string[];
  readonly anchor: AnchorWorkerSpec;
}

export interface RunningApi {
  readonly managedProcess: ManagedProcess;
  readonly baseUrl: string;
}

/** Boots a genuinely real, standalone apps/api process -- `node
 * dist/server.js`, the exact same entrypoint a real deployment uses (see
 * apps/api/package.json's own `bin` field) -- not an in-process Fastify
 * instance built by importing app.ts's internals. Every env var it reads
 * is required/validated by apps/api/src/config.ts itself; nothing here
 * bypasses that.
 *
 * spawnManaged(..., { detached: true }) plus killChildOnFailure (see
 * process-utils.ts): if apps/api never becomes healthy, or fails to spawn
 * at all, the process is killed before this function's promise ever
 * rejects -- nothing is left running for a caller to have to remember to
 * clean up. */
export async function startRealApi(options: StartRealApiOptions): Promise<RunningApi> {
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DDN_API_HOST: '127.0.0.1',
    DDN_API_PORT: String(options.port),
    DDN_CORS_ALLOWED_ORIGINS: options.corsAllowedOrigins.join(','),
    DDN_VALIDATOR_BIN: VALIDATOR_BINARY_PATH,
    DDN_POLICY_REGISTRY_PATH: POLICY_REGISTRY_PATH,
    DDN_EXECUTION_PROFILE_PATH: EXECUTION_PROFILE_PATH,
    DDN_VALIDATOR_SET_PATH: options.validatorSetPath,
    DDN_VALIDATOR_INSTANCES: JSON.stringify(
      options.validatorInstances.map((i) => ({ privateKeyFilePath: i.privateKeyFilePath, publicKeyFilePath: i.publicKeyFilePath }))
    ),
    DDN_SERVICE_TOKENS: JSON.stringify(options.serviceTokens),
    DDN_ANCHOR_RPC_URL: options.anchor.rpcUrl,
    DDN_ANCHOR_CHAIN_ID: String(options.anchor.chainId),
    DDN_ANCHOR_CONTRACT_ADDRESS: options.anchor.contractAddress,
    DDN_ANCHOR_SUBMITTER_PRIVATE_KEY: options.anchor.submitterPrivateKey,
    // Fast-converging anchor settings for a short-lived E2E run -- a real
    // deployment would use the loadAnchorWorkerBootConfig defaults
    // (5s poll, batch 50, 2 confirmations); this run can't wait that long
    // and doesn't need to prove the *default* tuning, just that anchoring
    // genuinely completes.
    DDN_ANCHOR_POLL_INTERVAL_MS: '1000',
    DDN_ANCHOR_BATCH_SIZE: '1',
    DDN_ANCHOR_CONFIRMATION_BLOCKS: '1',
  };

  const managedProcess = spawnManaged(process.execPath, [API_SERVER_ENTRYPOINT], { cwd: API_APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  managedProcess.process.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  managedProcess.process.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));

  try {
    await killChildOnFailure(managedProcess, () => waitForHttp(`${baseUrl}/healthz`, { timeoutMs: 15_000, acceptStatus: (status) => status === 200 }));
  } catch (error) {
    throw new Error(`apps/api never became healthy at ${baseUrl}/healthz: ${error instanceof Error ? error.message : String(error)}\n--- process output ---\n${output}`);
  }

  return { managedProcess, baseUrl };
}
