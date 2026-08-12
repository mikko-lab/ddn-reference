// SPDX-License-Identifier: Apache-2.0
// Regression test for the data-leakage fix in process-decision.ts:
// failDecision() must never put a raw exception message (which can embed
// file paths, e.g. from a missing validator-set or public-key file)
// straight into the client-visible decision record. Requires the real
// ddn-validator binary to get far enough into runDecision() for a later
// step (loading an intentionally-missing validator-set file) to throw a
// raw, non-ApiError exception -- same prerequisites/skip discipline as
// decision-runner.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEd25519KeyPair } from '@ddn/crypto';
import { AnchorSidecarStore } from '@ddn/anchor-service';
import { ValidatorProgressStore } from './validator-progress-store.js';
import type { ApiConfig } from '../config.js';
import type { AppDependencies } from '../dependencies.js';
import { InMemoryDecisionRepository } from './decision-repository.js';
import { processDecision } from './process-decision.js';
import type { PendingDecisionRecord } from './types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
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

test(
  'a missing validator-set file fails the decision without leaking its path to the client',
  { skip },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-api-process-decision-leak-'));
    const { privateKey, publicKey } = generateEd25519KeyPair();
    const privateKeyFilePath = join(dir, 'a.key');
    const publicKeyFilePath = join(dir, 'a.pub');
    await writeFile(privateKeyFilePath, privateKey);
    await chmod(privateKeyFilePath, 0o600);
    await writeFile(publicKeyFilePath, publicKey);

    // Deliberately missing -- buildExecutionRequest (which needs the real
    // validator binary) succeeds first, then loadTrustedValidatorSet
    // throws a raw ENOENT with this exact path embedded in its message.
    const missingValidatorSetPath = join(dir, 'does-not-exist.json');

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
      validatorSetPath: missingValidatorSetPath,
      validatorInstances: [{ privateKeyFilePath, publicKeyFilePath }],
      serviceTokens: [{ token: 't'.repeat(32), tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit'] }],
    };

    const decisionRepository = new InMemoryDecisionRepository();
    const deps: AppDependencies = {
      config,
      decisionRepository,
      policyRegistry: { entries: [{ policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: POLICY_DIR, status: 'ACTIVE' }] },
      verificationProfile: { profileId: 'ddn-wasm-v1', profilePath: PROFILE_PATH },
      anchorSidecarStore: new AnchorSidecarStore(),
      validatorProgressStore: new ValidatorProgressStore(),
    };

    const now = new Date().toISOString();
    const pending: PendingDecisionRecord = {
      decisionId: 'dec_leak_test_1',
      tenantId: 'tenant-a',
      policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
      input: {
        tenantId: 'tenant-a',
        vehicleId: 'vehicle-leak-test-01',
        sessionId: 'session-leak-test-01',
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
      idempotencyRequestHash: 'sha256:' + 'a'.repeat(64) as `sha256:${string}`,
      submittedAt: now,
      updatedAt: now,
      status: 'PENDING',
    };
    await decisionRepository.createOrGetByIdempotencyKey('tenant-a', pending.idempotencyRequestHash, () => pending);

    await processDecision(deps, pending);

    const record = await decisionRepository.get('dec_leak_test_1');
    assert.ok(record);
    assert.equal(record.status, 'FAILED');
    if (record.status === 'FAILED') {
      assert.equal(record.error.code, 'INTERNAL_ERROR');
      assert.equal(record.error.message, 'an unexpected internal error occurred while processing this decision');
      assert.ok(!record.error.message.includes(missingValidatorSetPath), 'error message must not include the file path');
      assert.ok(!record.error.message.includes(dir), 'error message must not include the temp directory path');
    }
  }
);
