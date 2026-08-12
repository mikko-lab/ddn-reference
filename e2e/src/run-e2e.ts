// SPDX-License-Identifier: Apache-2.0
// Orchestrates a genuinely real, no-mocks,
// no-silent-skips browser <-> API <-> validators <-> receipt <->
// anchoring E2E run, then hands off to Playwright to drive real browsers
// against it. Every process here is real: the actual ddn-validator
// release binary running the actual pinned WASM policy, a real apps/api
// process (the same dist/server.js a real deployment boots), a real
// freshly-spawned Anvil node with a real deployed DecisionAnchor.sol and
// a real in-process anchor worker submitting a real transaction, and
// apps/explorer + apps/demo-negotiation-reference as real `next build && next start`
// production servers. Nothing is mocked; any missing prerequisite throws
// rather than silently skipping (see preflight.ts).

import { mkdtemp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { startRealApi, type ServiceTokenSpec } from './api-process.js';
import { startFreshAnvil } from './anvil.js';
import { buildNextApp, startNextApp } from './next-app-process.js';
import { DEMO_REFERENCE_APP_DIR, E2E_DIR, EXPLORER_APP_DIR } from './paths.js';
import { runPreflightChecks } from './preflight.js';
import { teardown, type TeardownState } from './teardown.js';
import { buildDemoValidatorSet, writeDemoValidatorKeyFiles } from './validator-keys.js';
import { assertProfileIntegrity, deployDecisionAnchor, type TrustedDemoProfileV1 } from '@ddn/demo-trust-profile';

const ANVIL_PORT = 8649;
const API_PORT = 4100;
const EXPLORER_PORT = 4110;
const DEMO_REFERENCE_PORT = 4120;

// apps/demo-negotiation-reference hardcodes this exact tenantId into every
// NegotiationInputV1 it builds (see offer-input.ts's
// DEMO_REFERENCE_TENANT_ID) -- it is not configurable via env. apps/api
// rejects a submission whose input.tenantId doesn't match the
// authenticated token's own tenantId (TENANT_MISMATCH), so the service
// token this run issues for demo-reference's tenant MUST use this exact
// value, not an arbitrary name invented for this run. Confirmed the hard
// way: an arbitrary tenantId here produces a real 502 from a genuine
// upstream TENANT_MISMATCH rejection, not a mock/skip.
const DEMO_TENANT_ID = 'm7-demo-reference-tenant';
const EXPLORER_TENANT_ID = 'tenant-e2e-explorer';
const ALL_ROLES = ['decision:submit', 'decision:read', 'receipt:verify', 'policy:read'] as const;

function runtimeSecret(label: string): string {
  return `${label}_${randomBytes(32).toString('base64url')}`;
}

async function main(): Promise<number> {
  console.log('[e2e] running preflight checks (real validator binary, WASM policy, contract artifact, anvil on PATH)...');
  runPreflightChecks();

  const state: TeardownState = {};

  try {
    const tempDir = await mkdtemp(join(tmpdir(), 'ddn-e2e-'));
    state.tempDir = tempDir;

    const referenceServiceToken = runtimeSecret('svc_reference');
    const explorerDemoServiceToken = runtimeSecret('svc_explorer');

    console.log('[e2e] generating ephemeral validator identities and building their ValidatorSetV1...');
    const validatorInstances = await writeDemoValidatorKeyFiles(tempDir);
    const validatorSet = await buildDemoValidatorSet(validatorInstances);
    const validatorSetPath = join(tempDir, 'validator-set.json');
    await writeFile(validatorSetPath, JSON.stringify(validatorSet));

    console.log(`[e2e] starting a fresh Anvil node on port ${ANVIL_PORT}...`);
    const anvil = await startFreshAnvil(ANVIL_PORT, tempDir);
    state.anvil = anvil;

    console.log('[e2e] deploying DecisionAnchor.sol with the ephemeral local-chain account...');
    const deployed = await deployDecisionAnchor(anvil.rpcUrl, anvil.submitterPrivateKey);
    const profile: TrustedDemoProfileV1 = {
      schemaVersion: '1.0.0',
      validatorSet,
      chain: { chainId: deployed.chainId, contractAddress: deployed.contractAddress },
    };
    assertProfileIntegrity(profile);
    const contractAddress = deployed.contractAddress;
    console.log(`[e2e] built and verified this run's public trust profile on chain ${profile.chain.chainId}`);

    const serviceTokens: readonly ServiceTokenSpec[] = [
      { token: referenceServiceToken, tokenId: 'tok_e2e_reference', tenantId: DEMO_TENANT_ID, roles: [...ALL_ROLES] },
      { token: explorerDemoServiceToken, tokenId: 'tok_e2e_explorer_demo', tenantId: EXPLORER_TENANT_ID, roles: [...ALL_ROLES] },
    ];

    console.log(`[e2e] starting the real apps/api process (real coordinator + real ddn-validator subprocesses + real in-process anchor worker) on port ${API_PORT}...`);
    const api = await startRealApi({
      port: API_PORT,
      validatorSetPath,
      validatorInstances,
      serviceTokens,
      corsAllowedOrigins: [`http://localhost:${EXPLORER_PORT}`, `http://localhost:${DEMO_REFERENCE_PORT}`],
      anchor: {
        rpcUrl: anvil.rpcUrl,
        chainId: profile.chain.chainId,
        contractAddress,
        submitterPrivateKey: anvil.submitterPrivateKey,
      },
    });
    state.api = api;
    console.log(`[e2e] apps/api is healthy at ${api.baseUrl}`);

    // NEXT_PUBLIC_ vars are inlined at BUILD time, not read at runtime --
    // the browser calls Anvil's RPC directly (client-side chain read for
    // on-chain-root verification), so both apps must be built with this
    // set to this exact run's Anvil port.
    const sharedPublicEnv = {
      NEXT_PUBLIC_DDN_CHAIN_RPC_URL: anvil.rpcUrl,
      NEXT_PUBLIC_DDN_TRUSTED_PROFILE_JSON: JSON.stringify(profile),
    };

    console.log('[e2e] building apps/demo-negotiation-reference (real `next build`)...');
    const demoReferenceEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...sharedPublicEnv,
      DDN_API_BASE_URL: api.baseUrl,
      DDN_DEMO_REFERENCE_SERVICE_TOKEN: referenceServiceToken,
    };
    buildNextApp(DEMO_REFERENCE_APP_DIR, demoReferenceEnv);
    console.log(`[e2e] starting apps/demo-negotiation-reference (real \`next start\`) on port ${DEMO_REFERENCE_PORT}...`);
    const demoReference = await startNextApp(DEMO_REFERENCE_APP_DIR, DEMO_REFERENCE_PORT, demoReferenceEnv);
    state.demoReference = demoReference;

    console.log('[e2e] building apps/explorer (real `next build`)...');
    const explorerEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...sharedPublicEnv,
      DDN_API_BASE_URL: api.baseUrl,
      DDN_DEMO_SERVICE_TOKEN: explorerDemoServiceToken,
    };
    buildNextApp(EXPLORER_APP_DIR, explorerEnv);
    console.log(`[e2e] starting apps/explorer (real \`next start\`) on port ${EXPLORER_PORT}...`);
    const explorer = await startNextApp(EXPLORER_APP_DIR, EXPLORER_PORT, explorerEnv);
    state.explorer = explorer;

    console.log('[e2e] real stack is up. Handing off to Playwright for the real browser-driven suite...');
    const playwrightResult = spawnSync('pnpm', ['exec', 'playwright', 'test'], {
      cwd: E2E_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_DEMO_REFERENCE_BASE_URL: demoReference.baseUrl,
      },
    });

    return playwrightResult.status ?? 1;
  } finally {
    console.log('[e2e] tearing down: killing all spawned processes and removing temp files...');
    await teardown(state);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('[e2e] fatal error:', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
