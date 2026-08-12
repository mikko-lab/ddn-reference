// SPDX-License-Identifier: Apache-2.0
// Real integration test: 3 real ddn-validator processes via
// @ddn/coordinator's decide(), for the actual decision-runner.ts this API
// uses (not a mock of it). Mirrors apps/coordinator/src/decide.test.ts's
// prerequisites/skip discipline exactly: when DDN_VALIDATOR_BIN/
// DDN_POLICY_PACKAGE are explicitly set (CI's blocking step), a missing
// binary/policy package must fail loudly, never skip quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEd25519KeyPair } from '@ddn/crypto';
import { buildValidatorSetFromPublicKeyFiles } from '@ddn/coordinator';
import { buildValidatorSetV1, type CoordinatorFailureV1, type DecisionReceiptV1, type ValidatorSetV1 } from '@ddn/receipt-sdk';
import { ApiError } from '../errors/api-error.js';
import type { ApiConfig } from '../config.js';
import type { PolicyRegistryEntry } from '../policies/policy-registry.js';
import { assembleOutcomeFromReceipt, mapCoordinatorFailure, runDecision } from './decision-runner.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const VALIDATOR_BIN = process.env.DDN_VALIDATOR_BIN ?? join(REPO_ROOT, 'target/release/ddn-validator');
const POLICY_DIR = process.env.DDN_POLICY_PACKAGE ?? join(REPO_ROOT, 'policies/negotiation-v1/package');
const INPUT_FIXTURE_PATH = join(REPO_ROOT, 'packages/test-vectors/fixtures/negotiation-counter.json');

const prerequisitesMet = existsSync(VALIDATOR_BIN) && existsSync(join(POLICY_DIR, 'policy.wasm')) && existsSync(INPUT_FIXTURE_PATH);
const prerequisitesExplicitlyRequested = Boolean(process.env.DDN_VALIDATOR_BIN || process.env.DDN_POLICY_PACKAGE);
if (prerequisitesExplicitlyRequested && !prerequisitesMet) {
  throw new Error(
    `DDN_VALIDATOR_BIN=${VALIDATOR_BIN} / DDN_POLICY_PACKAGE=${POLICY_DIR} were explicitly set but the binary/policy.wasm/fixture don't exist there -- refusing to silently skip a check that was explicitly requested to run for real`
  );
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
    port: 4000,
    maxRequestBytes: 20_000,
    decisionTimeoutMs: 15_000,
    maxConcurrentDecisions: 50,
    corsAllowedOrigins: ['https://example.test'],
    validatorBinaryPath: VALIDATOR_BIN,
    policyRegistryPath: join(dir, 'unused-registry.json'),
    executionProfilePath: join(dir, 'unused-profile.json'),
    validatorSetPath,
    validatorInstances: [
      { privateKeyFilePath: a.privateKeyFilePath, publicKeyFilePath: a.publicKeyFilePath },
      { privateKeyFilePath: b.privateKeyFilePath, publicKeyFilePath: b.publicKeyFilePath },
      { privateKeyFilePath: c.privateKeyFilePath, publicKeyFilePath: c.publicKeyFilePath },
    ],
    serviceTokens: [{ token: 't'.repeat(32), tokenId: 'tok_a', tenantId: 'tenant-synthetic-01', roles: ['decision:submit'] }],
  };
}

function policyEntry(): PolicyRegistryEntry {
  return { policyId: 'negotiation-v1', policyVersion: '1.0.0', policyPackagePath: POLICY_DIR, status: 'ACTIVE' };
}

test(
  'runDecision reaches FINALIZED with a self-verified receipt from 3 real validator instances',
  { skip: !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-api-decision-runner-'));
    const config = await buildConfig(dir);
    const input = JSON.parse(await readFile(INPUT_FIXTURE_PATH, 'utf8')) as Record<string, unknown>;

    const outcome = await runDecision(config, {
      decisionId: 'dec_test_finalized_1',
      policyEntry: policyEntry(),
      profilePath: undefined,
      input,
    });

    assert.equal(outcome.kind, 'FINALIZED');
    if (outcome.kind === 'FINALIZED') {
      assert.equal(outcome.receipt.quorum.agreeingValidatorIds.length, 3);
    }
  }
);

test(
  'runDecision reaches NO_QUORUM when too few validator instances can produce a valid signed result',
  { skip: !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-api-decision-runner-'));
    const config = await buildConfig(dir);
    // Corrupt two of the three private keys -- a realistic "most
    // validators are down/misconfigured" scenario, not a mocked outcome.
    await writeFile(config.validatorInstances[1]!.privateKeyFilePath, 'not-a-valid-hex-private-key');
    await chmod(config.validatorInstances[1]!.privateKeyFilePath, 0o600);
    await writeFile(config.validatorInstances[2]!.privateKeyFilePath, 'also-not-valid');
    await chmod(config.validatorInstances[2]!.privateKeyFilePath, 0o600);
    const input = JSON.parse(await readFile(INPUT_FIXTURE_PATH, 'utf8')) as Record<string, unknown>;

    const outcome = await runDecision(config, {
      decisionId: 'dec_test_no_quorum_1',
      policyEntry: policyEntry(),
      profilePath: undefined,
      input,
    });

    assert.equal(outcome.kind, 'NO_QUORUM');
  }
);

// assembleOutcomeFromReceipt: the fail-closed gate, forced to actually
// fail. Uses the committed Milestone 4 golden-vector receipt (a real,
// validly-signed DecisionReceiptV1) -- no validator binary needed, since
// this tests decision-runner.ts's own handling of a verification result,
// not @ddn/receipt-sdk's verification logic itself (already covered by
// receipt-sdk's own test suite).

const GOLDEN_VECTORS_DIR = join(REPO_ROOT, 'packages/test-vectors/vectors/decision-receipt-v1');

function readGoldenVector(filename: string): unknown {
  return JSON.parse(readFileSync(join(GOLDEN_VECTORS_DIR, filename), 'utf8'));
}

const GOLDEN_RECEIPT = readGoldenVector('decision-receipt.json') as DecisionReceiptV1;
const GOLDEN_VALIDATOR_SET = readGoldenVector('validator-set.json') as ValidatorSetV1;

test('assembleOutcomeFromReceipt returns FINALIZED for a receipt that verifies against its matching validator set', () => {
  const outcome = assembleOutcomeFromReceipt(GOLDEN_RECEIPT, GOLDEN_VALIDATOR_SET);
  assert.equal(outcome.kind, 'FINALIZED');
});

test('assembleOutcomeFromReceipt throws RECEIPT_SELF_VERIFICATION_FAILED for a receipt that does not verify against the given validator set', () => {
  // Same 3 public keys as the golden validator set, but a different
  // threshold -- changes the computed validatorSetId, so it no longer
  // matches what the golden receipt's own quorum.validatorSetId claims.
  // This is deliberately NOT the receipt being tampered with (that's
  // already covered by @ddn/client-sdk's tests) -- it is
  // decision-runner.ts's OWN handling of a verification failure that is
  // under test here: does it actually throw and refuse to return
  // FINALIZED, rather than silently ignoring the result.
  const wrongValidatorSet = buildValidatorSetV1({
    schemaVersion: '1.0.0',
    threshold: 3,
    publicKeys: GOLDEN_VALIDATOR_SET.validators.map((v) => v.publicKey),
  });

  assert.throws(
    () => assembleOutcomeFromReceipt(GOLDEN_RECEIPT, wrongValidatorSet),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'RECEIPT_SELF_VERIFICATION_FAILED');
      return true;
    }
  );
});

// mapCoordinatorFailure: both branches of the failure-reason mapping,
// including EXECUTION_HASH_COLLISION -- previously untested anywhere in
// the suite (only NO_QUORUM was exercised, via the real 2-corrupted-keys
// test above).

function fakeCoordinatorFailure(reason: CoordinatorFailureV1['reason']): CoordinatorFailureV1 {
  return { schemaVersion: '1.0.0', requestId: 'req-test-1', reason, groups: [], rejected: [] };
}

test('mapCoordinatorFailure maps NO_QUORUM to a NO_QUORUM outcome', () => {
  const outcome = mapCoordinatorFailure(fakeCoordinatorFailure('NO_QUORUM'));
  assert.equal(outcome.kind, 'NO_QUORUM');
});

test('mapCoordinatorFailure maps EXECUTION_HASH_COLLISION to a FAILED outcome', () => {
  const outcome = mapCoordinatorFailure(fakeCoordinatorFailure('EXECUTION_HASH_COLLISION'));
  assert.equal(outcome.kind, 'FAILED');
  if (outcome.kind === 'FAILED') {
    assert.match(outcome.message, /execution hash collision/i);
  }
});
