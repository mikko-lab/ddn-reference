// SPDX-License-Identifier: Apache-2.0
// The proof this whole milestone exists for: an external client -- using
// ONLY the workspace @ddn/client-sdk reference package and a real HTTP connection
// (a real listening TCP port, not app.inject()), with NO import of
// @ddn/coordinator, no access to the ddn-validator binary or any private
// key, and no blind trust of the API's "FINALIZED" claim -- submits a
// decision, polls it, fetches its DecisionReceiptV1, and verifies it
// locally with @ddn/receipt-sdk before accepting the result. Covers the
// three quorum outcomes: 3/3, a degraded 2/3 (one validator instance
// down), and NO_QUORUM (too many down). Mirrors decision-runner.test.ts's
// and app.test.ts's prerequisites/skip discipline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { generateEd25519KeyPair } from '@ddn/crypto';
import { buildValidatorSetFromPublicKeyFiles } from '@ddn/coordinator';
import { AnchorSidecarStore } from '@ddn/anchor-service';
import { ValidatorProgressStore } from './decisions/validator-progress-store.js';
import type { ValidatorSetV1 } from '@ddn/receipt-sdk';
import { DdnClient, DdnDecisionFailedError, submitWaitAndVerify } from '@ddn/client-sdk';
import { buildApp } from './app.js';
import type { ApiConfig } from './config.js';
import { InMemoryDecisionRepository } from './decisions/decision-repository.js';
import { loadPolicyRegistry } from './policies/policy-registry.js';
import { loadVerificationProfile } from './policies/verification-profile.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VALIDATOR_BIN = process.env.DDN_VALIDATOR_BIN ?? join(REPO_ROOT, 'target/release/ddn-validator');
const POLICY_DIR = process.env.DDN_POLICY_PACKAGE ?? join(REPO_ROOT, 'policies/negotiation-v1/package');
const REGISTRY_PATH = join(REPO_ROOT, 'policies/registry.json');
const PROFILE_PATH = join(REPO_ROOT, 'packages/config/profiles/ddn-wasm-v1.json');

const prerequisitesMet = existsSync(VALIDATOR_BIN) && existsSync(join(POLICY_DIR, 'policy.wasm'));
const prerequisitesExplicitlyRequested = Boolean(process.env.DDN_VALIDATOR_BIN || process.env.DDN_POLICY_PACKAGE);
if (prerequisitesExplicitlyRequested && !prerequisitesMet) {
  throw new Error(
    `DDN_VALIDATOR_BIN=${VALIDATOR_BIN} / DDN_POLICY_PACKAGE=${POLICY_DIR} were explicitly set but the binary/policy.wasm don't exist there -- refusing to silently skip a check that was explicitly requested to run for real`
  );
}
const skip = !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first';

const SERVICE_TOKEN = 'e'.repeat(32);

async function writeKeypairFiles(dir: string, name: string): Promise<{ privateKeyFilePath: string; publicKeyFilePath: string }> {
  const { publicKey, privateKey } = generateEd25519KeyPair();
  const privateKeyFilePath = join(dir, `${name}.key`);
  const publicKeyFilePath = join(dir, `${name}.pub`);
  await writeFile(privateKeyFilePath, privateKey);
  await chmod(privateKeyFilePath, 0o600);
  await writeFile(publicKeyFilePath, publicKey);
  return { privateKeyFilePath, publicKeyFilePath };
}

interface StartedServer {
  readonly app: FastifyInstance;
  readonly baseUrl: string;
  readonly validatorSet: ValidatorSetV1;
}

/** Starts a real, listening apps/api instance on an OS-assigned loopback
 * port -- an external client must reach this over an actual TCP
 * connection, not Fastify's in-process app.inject(). `corruptKeyCount`
 * lets a scenario simulate 0, 1, or 2 of the 3 validator instances being
 * unusable. */
async function startServer(corruptKeyCount: 0 | 1 | 2): Promise<StartedServer> {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-e2e-'));
  const a = await writeKeypairFiles(dir, 'a');
  const b = await writeKeypairFiles(dir, 'b');
  const c = await writeKeypairFiles(dir, 'c');
  const instances = [a, b, c];
  for (let i = 0; i < corruptKeyCount; i += 1) {
    await writeFile(instances[i]!.privateKeyFilePath, `not-a-valid-hex-private-key-${i}`);
    await chmod(instances[i]!.privateKeyFilePath, 0o600);
  }

  const validatorSet = await buildValidatorSetFromPublicKeyFiles([a.publicKeyFilePath, b.publicKeyFilePath, c.publicKeyFilePath], 2);
  const validatorSetPath = join(dir, 'validator-set.json');
  await writeFile(validatorSetPath, JSON.stringify(validatorSet));

  const config: ApiConfig = {
    host: '127.0.0.1',
    port: 0,
    maxRequestBytes: 20_000,
    decisionTimeoutMs: 15_000,
    maxConcurrentDecisions: 50,
    corsAllowedOrigins: ['https://example.test'],
    validatorBinaryPath: VALIDATOR_BIN,
    policyRegistryPath: REGISTRY_PATH,
    executionProfilePath: PROFILE_PATH,
    validatorSetPath,
    validatorInstances: instances.map((i) => ({ privateKeyFilePath: i.privateKeyFilePath, publicKeyFilePath: i.publicKeyFilePath })),
    serviceTokens: [{ token: SERVICE_TOKEN, tokenId: 'tok_e2e', tenantId: 'tenant-e2e', roles: ['decision:submit', 'decision:read'] }],
  };

  const app = await buildApp({
    config,
    decisionRepository: new InMemoryDecisionRepository(),
    policyRegistry: loadPolicyRegistry(config.policyRegistryPath),
    verificationProfile: loadVerificationProfile(config.executionProfilePath),
    anchorSidecarStore: new AnchorSidecarStore(),
    validatorProgressStore: new ValidatorProgressStore(),
  });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, baseUrl, validatorSet };
}

const SUBMIT_REQUEST = {
  schemaVersion: '1.0.0',
  policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
  input: {
    vehicleId: 'vehicle-e2e-01',
    sessionId: 'session-e2e-01',
    listPriceCents: 2_500_000,
    floorPriceCents: 2_300_000,
    customerOfferCents: 2_299_999,
    offerNumber: 1,
    maxOffers: 4,
    conditionReportAcknowledged: true,
    policyEffectiveAt: '2026-01-01T00:00:00Z',
    schemaVersion: '1.0.0',
  },
  verificationProfileId: 'ddn-wasm-v1',
};

test(
  'external client: 3/3 quorum reaches FINALIZED and passes local verification',
  { skip },
  async () => {
    const { app, baseUrl, validatorSet } = await startServer(0);
    try {
      const client = new DdnClient({ baseUrl, serviceToken: SERVICE_TOKEN });
      const result = await submitWaitAndVerify(client, SUBMIT_REQUEST, { validatorSet, pollIntervalMs: 50 });
      assert.equal(result.verification.ok, true);
      assert.equal(result.receipt.quorum.agreeingValidatorIds.length, 3);
    } finally {
      await app.close();
    }
  }
);

test(
  'external client: a degraded 2/3 quorum (one validator instance down) still reaches FINALIZED and passes local verification',
  { skip },
  async () => {
    const { app, baseUrl, validatorSet } = await startServer(1);
    try {
      const client = new DdnClient({ baseUrl, serviceToken: SERVICE_TOKEN });
      const result = await submitWaitAndVerify(client, SUBMIT_REQUEST, { validatorSet, pollIntervalMs: 50 });
      assert.equal(result.verification.ok, true);
      assert.equal(result.receipt.quorum.agreeingValidatorIds.length, 2);
    } finally {
      await app.close();
    }
  }
);

test(
  'external client: too many validator instances down resolves to NO_QUORUM, surfaced as DdnDecisionFailedError',
  { skip },
  async () => {
    const { app, baseUrl, validatorSet } = await startServer(2);
    try {
      const client = new DdnClient({ baseUrl, serviceToken: SERVICE_TOKEN });
      await assert.rejects(
        () => submitWaitAndVerify(client, SUBMIT_REQUEST, { validatorSet, pollIntervalMs: 50 }),
        (error: unknown) => {
          assert.ok(error instanceof DdnDecisionFailedError);
          assert.equal(error.status, 'NO_QUORUM');
          return true;
        }
      );
    } finally {
      await app.close();
    }
  }
);
