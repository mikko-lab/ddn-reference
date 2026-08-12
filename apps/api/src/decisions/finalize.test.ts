// SPDX-License-Identifier: Apache-2.0
// Milestone 6: proves the synchronous local finalization boundary (see
// finalize.ts) actually holds -- a forced failure in anchor-eligibility
// marking must never leave a decision FINALIZED without it. Reuses
// decision-runner.test.ts's real-3-validator fixture: this needs an
// outcome that genuinely reaches FINALIZED, not a mocked one, so the
// finalization boundary is exercised for real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEd25519KeyPair } from '@ddn/crypto';
import { buildValidatorSetFromPublicKeyFiles } from '@ddn/coordinator';
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
const INPUT_FIXTURE_PATH = join(REPO_ROOT, 'packages/test-vectors/fixtures/negotiation-counter.json');
const REGISTRY_PATH = join(REPO_ROOT, 'policies/registry.json');
const PROFILE_PATH = join(REPO_ROOT, 'packages/config/profiles/ddn-wasm-v1.json');

const prerequisitesMet = existsSync(VALIDATOR_BIN) && existsSync(join(POLICY_DIR, 'policy.wasm')) && existsSync(INPUT_FIXTURE_PATH);
const prerequisitesExplicitlyRequested = Boolean(process.env.DDN_VALIDATOR_BIN || process.env.DDN_POLICY_PACKAGE);
if (prerequisitesExplicitlyRequested && !prerequisitesMet) {
  throw new Error(
    `DDN_VALIDATOR_BIN=${VALIDATOR_BIN} / DDN_POLICY_PACKAGE=${POLICY_DIR} were explicitly set but the binary/policy.wasm/fixture don't exist there -- refusing to silently skip a check that was explicitly requested to run for real`
  );
}

/** Forces the exact failure mode this test exists to catch: the sidecar
 * store used by finalize.ts's synchronous boundary throws. Subclassed
 * (not a plain fake object) so it still satisfies AppDependencies'
 * concrete AnchorSidecarStore type. */
class ThrowingAnchorSidecarStore extends AnchorSidecarStore {
  override markEligible(): boolean {
    throw new Error('forced sidecar failure for test');
  }
}

async function writeKeypairFiles(dir: string, name: string): Promise<{ privateKeyFilePath: string; publicKeyFilePath: string }> {
  const { publicKey, privateKey } = generateEd25519KeyPair();
  const privateKeyFilePath = join(dir, `${name}.key`);
  const publicKeyFilePath = join(dir, `${name}.pub`);
  await writeFile(privateKeyFilePath, privateKey);
  await chmod(privateKeyFilePath, 0o600);
  await writeFile(publicKeyFilePath, publicKey);
  return { privateKeyFilePath, publicKeyFilePath };
}

async function buildConfig(dir: string): Promise<ApiConfig> {
  const a = await writeKeypairFiles(dir, 'a');
  const b = await writeKeypairFiles(dir, 'b');
  const c = await writeKeypairFiles(dir, 'c');
  const validatorSet = await buildValidatorSetFromPublicKeyFiles([a.publicKeyFilePath, b.publicKeyFilePath, c.publicKeyFilePath], 2);
  const validatorSetPath = join(dir, 'validator-set.json');
  await writeFile(validatorSetPath, JSON.stringify(validatorSet));
  return {
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
    validatorInstances: [
      { privateKeyFilePath: a.privateKeyFilePath, publicKeyFilePath: a.publicKeyFilePath },
      { privateKeyFilePath: b.privateKeyFilePath, publicKeyFilePath: b.publicKeyFilePath },
      { privateKeyFilePath: c.privateKeyFilePath, publicKeyFilePath: c.publicKeyFilePath },
    ],
    serviceTokens: [{ token: 't'.repeat(32), tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit'] }],
  };
}

test(
  'a forced anchor-sidecar failure never leaves the decision FINALIZED without anchor-eligibility',
  { skip: !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-api-finalize-boundary-'));
    const config = await buildConfig(dir);
    const input = JSON.parse(readFileSync(INPUT_FIXTURE_PATH, 'utf8')) as Record<string, unknown>;

    const decisionRepository = new InMemoryDecisionRepository();
    const throwingSidecarStore = new ThrowingAnchorSidecarStore();
    const deps: AppDependencies = {
      config,
      decisionRepository,
      policyRegistry: { entries: [{ policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: POLICY_DIR, status: 'ACTIVE' }] },
      verificationProfile: { profileId: 'ddn-wasm-v1', profilePath: PROFILE_PATH },
      anchorSidecarStore: throwingSidecarStore,
      validatorProgressStore: new ValidatorProgressStore(),
    };

    const now = new Date().toISOString();
    const pending: PendingDecisionRecord = {
      decisionId: 'dec_finalize_boundary_1',
      tenantId: 'tenant-a',
      policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
      input,
      verificationProfileId: 'ddn-wasm-v1',
      idempotencyRequestHash: ('sha256:' + 'a'.repeat(64)) as `sha256:${string}`,
      submittedAt: now,
      updatedAt: now,
      status: 'PENDING',
    };
    await decisionRepository.createOrGetByIdempotencyKey('tenant-a', pending.idempotencyRequestHash, () => pending);

    // The real 3-validator run genuinely reaches FINALIZED -- proven
    // separately by decision-runner.test.ts. What this test actually
    // checks is what happens next: the sidecar throws during the
    // finalization boundary, and that must not leave a FINALIZED record
    // with no corresponding anchor-eligibility entry anywhere.
    await processDecision(deps, pending);

    const record = await decisionRepository.get('dec_finalize_boundary_1');
    assert.ok(record);
    assert.notEqual(record.status, 'FINALIZED', 'a decision must never be FINALIZED when anchor-eligibility marking failed');
    assert.equal(record.status, 'FAILED');
    assert.equal(throwingSidecarStore.getByDecisionId('dec_finalize_boundary_1'), undefined, 'no eligibility entry should exist either, since markEligible itself threw');
  }
);
