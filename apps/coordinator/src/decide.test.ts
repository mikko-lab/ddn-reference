// SPDX-License-Identifier: Apache-2.0
// End-to-end integration test for the full Milestone 4 acceptance chain:
// ExecutionRequestV1 -> three separate, real Rust `ddn-validator` processes
// -> three SignedValidatorResultV1s -> TypeScript identity/signature checks
// -> 2/3 quorum -> canonical DecisionReceiptV1 -> offline verification via
// @ddn/receipt-sdk. See docs/decision-receipt-v1.md.
//
// Requires `cargo build --release -p ddn-validator` and
// `scripts/build-policy.sh` to have been run first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateEd25519KeyPair } from '@ddn/crypto';
import { deriveValidatorId, verifyDecisionReceipt, parseExecutionRequestV1 } from '@ddn/receipt-sdk';
import { buildValidatorSetFromPublicKeyFiles } from './build-validator-set.js';
import { decide, type ValidatorProgressEvent } from './decide.js';

const execFileAsync = promisify(execFile);

// DDN_VALIDATOR_BIN/DDN_POLICY_PACKAGE let CI point this test at artifacts
// built in a different step/job than this test itself runs in (see
// .github/workflows/ci.yml's `wasm` job) without relying on this file's
// own on-disk position matching the repo layout. Local `pnpm test` still
// works with neither set, defaulting to the obvious repo-relative paths.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VALIDATOR_BIN = process.env.DDN_VALIDATOR_BIN ?? join(REPO_ROOT, 'target/release/ddn-validator');
const POLICY_DIR = process.env.DDN_POLICY_PACKAGE ?? join(REPO_ROOT, 'policies/negotiation-v1/package');
const INPUT_FIXTURE = join(REPO_ROOT, 'packages/test-vectors/fixtures/negotiation-counter.json');

async function writeKeypairFiles(dir: string, name: string): Promise<{ privateKeyFilePath: string; publicKeyFilePath: string; publicKeyHex: string }> {
  const { publicKey, privateKey } = generateEd25519KeyPair();
  const privateKeyFilePath = join(dir, `${name}.key`);
  const publicKeyFilePath = join(dir, `${name}.pub`);
  await writeFile(privateKeyFilePath, privateKey);
  await chmod(privateKeyFilePath, 0o600); // ddn-validator refuses to read an overly-permissive key file
  await writeFile(publicKeyFilePath, publicKey);
  return { privateKeyFilePath, publicKeyFilePath, publicKeyHex: publicKey };
}

const prerequisitesMet = existsSync(VALIDATOR_BIN) && existsSync(join(POLICY_DIR, 'policy.wasm'));
// When DDN_VALIDATOR_BIN/DDN_POLICY_PACKAGE are explicitly set (CI's
// blocking coordinator-integration step, not a plain local `pnpm test`
// run), missing prerequisites must fail loudly, not skip quietly -- a
// silent skip here would let this exact check pass by doing nothing,
// which defeats the point of it being a *blocking* proof that the
// coordinator and the real Rust validator actually talk to each other.
const prerequisitesExplicitlyRequested = Boolean(process.env.DDN_VALIDATOR_BIN || process.env.DDN_POLICY_PACKAGE);
if (prerequisitesExplicitlyRequested && !prerequisitesMet) {
  throw new Error(
    `DDN_VALIDATOR_BIN=${VALIDATOR_BIN} / DDN_POLICY_PACKAGE=${POLICY_DIR} were explicitly set but the binary/policy.wasm don't exist there -- refusing to silently skip a check that was explicitly requested to run for real`,
  );
}

test(
  'full chain: 3 real ddn-validator processes -> quorum -> DecisionReceiptV1 -> offline verification',
  { skip: !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-e2e-'));
    const a = await writeKeypairFiles(dir, 'a');
    const b = await writeKeypairFiles(dir, 'b');
    const c = await writeKeypairFiles(dir, 'c');

    const requestPath = join(dir, 'request.json');
    const { stdout: requestJson } = await execFileAsync(VALIDATOR_BIN, [
      'build-request',
      '--policy',
      POLICY_DIR,
      '--input',
      INPUT_FIXTURE,
      '--request-id',
      'req-coordinator-e2e-1',
    ]);
    await writeFile(requestPath, requestJson);
    const request = parseExecutionRequestV1(JSON.parse(requestJson));

    const validatorSet = await buildValidatorSetFromPublicKeyFiles([a.publicKeyFilePath, b.publicKeyFilePath, c.publicKeyFilePath], 2);

    const outcome = await decide({
      validatorBinaryPath: VALIDATOR_BIN,
      policyPackagePath: POLICY_DIR,
      profilePath: undefined,
      request,
      requestPath,
      validatorSet,
      validatorInstances: [
        { privateKeyFilePath: a.privateKeyFilePath, publicKeyHex: a.publicKeyHex },
        { privateKeyFilePath: b.privateKeyFilePath, publicKeyHex: b.publicKeyHex },
        { privateKeyFilePath: c.privateKeyFilePath, publicKeyHex: c.publicKeyHex },
      ],
      timeoutMs: 15_000,
    });

    assert.equal(outcome.failure, null);
    assert.notEqual(outcome.receipt, null);
    assert.equal(outcome.perValidatorDiagnostics.every((d) => d.outcome === 'SUCCESS'), true);
    assert.equal(outcome.receipt?.quorum.agreeingValidatorIds.length, 3);

    const report = verifyDecisionReceipt(outcome.receipt, validatorSet);
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.passed)));
  },
);

test(
  "one validator instance's own private key file is corrupted -- still reaches 2/3 quorum from the real remaining two",
  { skip: !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-e2e-'));
    const a = await writeKeypairFiles(dir, 'a');
    const b = await writeKeypairFiles(dir, 'b');
    const c = await writeKeypairFiles(dir, 'c');
    // Corrupt c's own private key file -- its ddn-validator execute
    // process will genuinely fail on its own (not a fake/skipped process),
    // a realistic stand-in for "this validator operator is misconfigured."
    await writeFile(c.privateKeyFilePath, 'not-a-valid-hex-private-key');
    await chmod(c.privateKeyFilePath, 0o600);

    const { stdout: requestJson } = await execFileAsync(VALIDATOR_BIN, [
      'build-request',
      '--policy',
      POLICY_DIR,
      '--input',
      INPUT_FIXTURE,
      '--request-id',
      'req-coordinator-e2e-partial-1',
    ]);
    const requestPath = join(dir, 'request.json');
    await writeFile(requestPath, requestJson);
    const request = parseExecutionRequestV1(JSON.parse(requestJson));

    const validatorSet = await buildValidatorSetFromPublicKeyFiles([a.publicKeyFilePath, b.publicKeyFilePath, c.publicKeyFilePath], 2);

    const outcome = await decide({
      validatorBinaryPath: VALIDATOR_BIN,
      policyPackagePath: POLICY_DIR,
      profilePath: undefined,
      request,
      requestPath,
      validatorSet,
      validatorInstances: [
        { privateKeyFilePath: a.privateKeyFilePath, publicKeyHex: a.publicKeyHex },
        { privateKeyFilePath: b.privateKeyFilePath, publicKeyHex: b.publicKeyHex },
        { privateKeyFilePath: c.privateKeyFilePath, publicKeyHex: c.publicKeyHex },
      ],
      timeoutMs: 15_000,
    });

    assert.notEqual(outcome.receipt, null);
    assert.equal(outcome.receipt?.quorum.agreeingValidatorIds.length, 2);
  },
);

test(
  'onValidatorProgress reports real RUNNING -> SUCCEEDED events from 3 real validator processes, in the order they actually settle',
  { skip: !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-e2e-progress-'));
    const a = await writeKeypairFiles(dir, 'a');
    const b = await writeKeypairFiles(dir, 'b');
    const c = await writeKeypairFiles(dir, 'c');

    const { stdout: requestJson } = await execFileAsync(VALIDATOR_BIN, [
      'build-request',
      '--policy',
      POLICY_DIR,
      '--input',
      INPUT_FIXTURE,
      '--request-id',
      'req-coordinator-e2e-progress-1',
    ]);
    const requestPath = join(dir, 'request.json');
    await writeFile(requestPath, requestJson);
    const request = parseExecutionRequestV1(JSON.parse(requestJson));

    const validatorSet = await buildValidatorSetFromPublicKeyFiles([a.publicKeyFilePath, b.publicKeyFilePath, c.publicKeyFilePath], 2);
    const expectedIds = new Set([a, b, c].map((k) => deriveValidatorId(k.publicKeyHex)));

    const events: ValidatorProgressEvent[] = [];
    const outcome = await decide({
      validatorBinaryPath: VALIDATOR_BIN,
      policyPackagePath: POLICY_DIR,
      profilePath: undefined,
      request,
      requestPath,
      validatorSet,
      validatorInstances: [
        { privateKeyFilePath: a.privateKeyFilePath, publicKeyHex: a.publicKeyHex },
        { privateKeyFilePath: b.privateKeyFilePath, publicKeyHex: b.publicKeyHex },
        { privateKeyFilePath: c.privateKeyFilePath, publicKeyHex: c.publicKeyHex },
      ],
      timeoutMs: 15_000,
      onValidatorProgress: (event) => events.push(event),
    });

    assert.notEqual(outcome.receipt, null);

    const runningEvents = events.filter((e) => e.phase === 'RUNNING');
    const succeededEvents = events.filter((e) => e.phase === 'SUCCEEDED');
    assert.equal(runningEvents.length, 3, 'exactly one RUNNING event per real validator instance');
    assert.equal(succeededEvents.length, 3, 'exactly one SUCCEEDED event per real validator instance');
    assert.deepEqual(new Set(runningEvents.map((e) => e.validatorId)), expectedIds);
    assert.deepEqual(new Set(succeededEvents.map((e) => e.validatorId)), expectedIds);

    for (const event of succeededEvents) {
      assert.ok(event.outputHash, 'a SUCCEEDED event must carry the validated outputHash');
      assert.equal(event.outputHash, outcome.receipt?.consensus.outputHash, "must match the receipt's own agreed outputHash, not a fabricated value");
      assert.ok(!Number.isNaN(Date.parse(event.at)), 'timestamp must be a real, parseable ISO time');
    }
    // Never leaks anything beyond validatorId/phase/at/outputHash.
    for (const event of events) {
      assert.deepEqual(Object.keys(event).sort(), event.phase === 'SUCCEEDED' ? ['at', 'outputHash', 'phase', 'validatorId'] : ['at', 'phase', 'validatorId']);
    }
  },
);

test(
  "onValidatorProgress reports FAILED for a real validator process that genuinely fails on its own corrupted key",
  { skip: !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-e2e-progress-fail-'));
    const a = await writeKeypairFiles(dir, 'a');
    const b = await writeKeypairFiles(dir, 'b');
    const c = await writeKeypairFiles(dir, 'c');
    await writeFile(c.privateKeyFilePath, 'not-a-valid-hex-private-key');
    await chmod(c.privateKeyFilePath, 0o600);

    const { stdout: requestJson } = await execFileAsync(VALIDATOR_BIN, [
      'build-request',
      '--policy',
      POLICY_DIR,
      '--input',
      INPUT_FIXTURE,
      '--request-id',
      'req-coordinator-e2e-progress-fail-1',
    ]);
    const requestPath = join(dir, 'request.json');
    await writeFile(requestPath, requestJson);
    const request = parseExecutionRequestV1(JSON.parse(requestJson));

    const validatorSet = await buildValidatorSetFromPublicKeyFiles([a.publicKeyFilePath, b.publicKeyFilePath, c.publicKeyFilePath], 2);
    const failingId = deriveValidatorId(c.publicKeyHex);

    const events: ValidatorProgressEvent[] = [];
    await decide({
      validatorBinaryPath: VALIDATOR_BIN,
      policyPackagePath: POLICY_DIR,
      profilePath: undefined,
      request,
      requestPath,
      validatorSet,
      validatorInstances: [
        { privateKeyFilePath: a.privateKeyFilePath, publicKeyHex: a.publicKeyHex },
        { privateKeyFilePath: b.privateKeyFilePath, publicKeyHex: b.publicKeyHex },
        { privateKeyFilePath: c.privateKeyFilePath, publicKeyHex: c.publicKeyHex },
      ],
      timeoutMs: 15_000,
      onValidatorProgress: (event) => events.push(event),
    });

    const failingEvents = events.filter((e) => e.validatorId === failingId);
    assert.deepEqual(
      failingEvents.map((e) => e.phase),
      ['RUNNING', 'FAILED']
    );
    assert.ok(!('outputHash' in failingEvents[1]!), 'a FAILED event must never carry an outputHash');
  },
);
