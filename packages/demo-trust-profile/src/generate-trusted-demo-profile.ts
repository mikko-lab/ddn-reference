#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Milestone 7: the only way to (re)write profile/trusted-demo-profile.json
// -- mirrors packages/receipt-sdk's generate-merkle-vectors.ts governance
// exactly. Never run automatically (not at build time, not at demo boot):
// only a human invoking --confirm-update deliberately updates the
// committed trust anchor.
//
// Builds the ValidatorSetV1 from DEMO_VALIDATOR_KEYS' public keys, then
// spins up a throwaway local Anvil instance to deploy DecisionAnchor.sol
// deterministically (dev account #0, nonce 0 on a freshly reset chain --
// see deploy-and-verify.ts) and capture the resulting chainId/contract
// address. This guarantees the committed contractAddress is exactly what
// a real fresh Anvil + this exact deploy path produces, so the demo
// stack's later fail-closed check (deployAndVerifyDecisionAnchor) will
// legitimately match.
//
// --check: fails loudly if the committed file doesn't match what this
// package's current implementation (keys + contract bytecode) produces.
// --confirm-update: the only way to (re)write the file. No argument-less
// default.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { spawn, type ChildProcess } from 'node:child_process';
import { createPublicClient, http } from 'viem';
import { buildValidatorSetV1 } from '@ddn/receipt-sdk';
import { DEMO_VALIDATOR_KEYS } from './test-fixtures/fixed-demo-validator-keys.js';
import {
  contractArtifactExists,
  deployDecisionAnchorDeterministically,
  CONTRACT_ARTIFACT,
} from './test-fixtures/fixed-local-anvil-deploy.js';
import { TRUSTED_DEMO_PROFILE_PATH } from './load-profile.js';
import type { TrustedDemoProfileV1 } from './trusted-demo-profile.js';

const GENERATOR_ANVIL_PORT = 8647;
const GENERATOR_RPC_URL = `http://127.0.0.1:${GENERATOR_ANVIL_PORT}`;

async function waitForAnvil(): Promise<void> {
  const client = createPublicClient({ transport: http(GENERATOR_RPC_URL) });
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

async function computeChain(): Promise<TrustedDemoProfileV1['chain']> {
  if (!contractArtifactExists()) {
    throw new Error(`${CONTRACT_ARTIFACT} does not exist -- run \`forge build\` in contracts/ first`);
  }
  let anvilProcess: ChildProcess | undefined;
  try {
    anvilProcess = spawn('anvil', ['--port', String(GENERATOR_ANVIL_PORT), '--silent'], { stdio: 'ignore' });
    await waitForAnvil();
    const deployed = await deployDecisionAnchorDeterministically(GENERATOR_RPC_URL);
    return { chainId: deployed.chainId, contractAddress: deployed.contractAddress };
  } finally {
    anvilProcess?.kill();
  }
}

function buildProfile(chain: TrustedDemoProfileV1['chain']): TrustedDemoProfileV1 {
  const validatorSet = buildValidatorSetV1({
    schemaVersion: '1.0.0',
    threshold: 2,
    publicKeys: [DEMO_VALIDATOR_KEYS.a.publicKey, DEMO_VALIDATOR_KEYS.b.publicKey, DEMO_VALIDATOR_KEYS.c.publicKey],
  });
  return { schemaVersion: '1.0.0', validatorSet, chain };
}

function serialize(profile: TrustedDemoProfileV1): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      'confirm-update': { type: 'boolean', default: false },
    },
  });

  if (values.check === values['confirm-update']) {
    throw new Error('pass exactly one of --check or --confirm-update');
  }

  const chain = await computeChain();
  const generated = serialize(buildProfile(chain));

  if (values['confirm-update']) {
    await mkdir(dirname(TRUSTED_DEMO_PROFILE_PATH), { recursive: true });
    await writeFile(TRUSTED_DEMO_PROFILE_PATH, generated);
    console.log(`wrote ${TRUSTED_DEMO_PROFILE_PATH}`);
    return;
  }

  let committed: string;
  try {
    committed = await readFile(TRUSTED_DEMO_PROFILE_PATH, 'utf8');
  } catch {
    throw new Error(
      `${TRUSTED_DEMO_PROFILE_PATH} does not exist -- run \`pnpm --filter @ddn/demo-trust-profile run profile:generate\` and commit the result`
    );
  }
  if (committed !== generated) {
    throw new Error(
      `${TRUSTED_DEMO_PROFILE_PATH} is out of date with the current implementation -- run \`pnpm --filter @ddn/demo-trust-profile run profile:generate\` and commit the result`
    );
  }
  console.log(`${TRUSTED_DEMO_PROFILE_PATH} is up to date`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
