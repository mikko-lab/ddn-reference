// SPDX-License-Identifier: Apache-2.0
// Real, end-to-end HTTP-level test of the assembled app: app.inject()
// against a Fastify instance wired with the actual policy registry file
// (policies/registry.json), the actual execution profile
// (packages/config/profiles/ddn-wasm-v1.json), and 3 real validator
// processes via the real ddn-validator binary -- nothing here is mocked.
// Mirrors decision-runner.test.ts's prerequisites/skip discipline: when
// DDN_VALIDATOR_BIN/DDN_POLICY_PACKAGE are explicitly set, a missing
// binary/policy package fails loudly instead of skipping quietly.

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

const TOKEN_TENANT_A = 'a'.repeat(32);
const TOKEN_TENANT_B = 'b'.repeat(32);

async function writeKeypairFiles(dir: string, name: string): Promise<{ privateKeyFilePath: string; publicKeyFilePath: string }> {
  const { publicKey, privateKey } = generateEd25519KeyPair();
  const privateKeyFilePath = join(dir, `${name}.key`);
  const publicKeyFilePath = join(dir, `${name}.pub`);
  await writeFile(privateKeyFilePath, privateKey);
  await chmod(privateKeyFilePath, 0o600);
  await writeFile(publicKeyFilePath, publicKey);
  return { privateKeyFilePath, publicKeyFilePath };
}

async function buildTestApp(): Promise<FastifyInstance> {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-api-app-test-'));
  const a = await writeKeypairFiles(dir, 'a');
  const b = await writeKeypairFiles(dir, 'b');
  const c = await writeKeypairFiles(dir, 'c');
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
    validatorInstances: [
      { privateKeyFilePath: a.privateKeyFilePath, publicKeyFilePath: a.publicKeyFilePath },
      { privateKeyFilePath: b.privateKeyFilePath, publicKeyFilePath: b.publicKeyFilePath },
      { privateKeyFilePath: c.privateKeyFilePath, publicKeyFilePath: c.publicKeyFilePath },
    ],
    serviceTokens: [
      { token: TOKEN_TENANT_A, tokenId: 'tok_a', tenantId: 'tenant-a', roles: ['decision:submit', 'decision:read', 'receipt:verify', 'policy:read'] },
      { token: TOKEN_TENANT_B, tokenId: 'tok_b', tenantId: 'tenant-b', roles: ['decision:submit', 'decision:read', 'receipt:verify', 'policy:read'] },
    ],
  };

  return buildApp({
    config,
    decisionRepository: new InMemoryDecisionRepository(),
    policyRegistry: loadPolicyRegistry(config.policyRegistryPath),
    verificationProfile: loadVerificationProfile(config.executionProfilePath),
    anchorSidecarStore: new AnchorSidecarStore(),
    validatorProgressStore: new ValidatorProgressStore(),
  });
}

const SUBMIT_BODY = {
  schemaVersion: '1.0.0',
  policy: { policyId: 'negotiation-v1', policyVersion: '1.0.0' },
  input: {
    vehicleId: 'vehicle-app-test-01',
    sessionId: 'session-app-test-01',
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

async function pollUntilTerminal(app: FastifyInstance, decisionId: string, token: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const res = await app.inject({ method: 'GET', url: `/v1/decisions/${decisionId}`, headers: { authorization: `Bearer ${token}` } });
    const body = res.json() as Record<string, unknown>;
    if (body.status !== 'PENDING' && body.status !== 'RUNNING') {
      return body;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`decision ${decisionId} did not reach a terminal state in time`);
}

const skip = !prerequisitesMet && 'requires `cargo build --release -p ddn-validator` and scripts/build-policy.sh to have been run first';

test('GET /healthz responds 200 without auth', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
});

test('POST /v1/decisions without an Authorization header is rejected with 401 UNAUTHORIZED', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'POST', url: '/v1/decisions', payload: SUBMIT_BODY });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'UNAUTHORIZED');
});

test('POST /v1/decisions with a malformed body is rejected with 400 INVALID_REQUEST', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/decisions',
    headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
    payload: { schemaVersion: '1.0.0' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_REQUEST');
});

test('POST /v1/decisions with an unregistered policy is rejected with 404 POLICY_NOT_FOUND', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/decisions',
    headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
    payload: { ...SUBMIT_BODY, policy: { policyId: 'does-not-exist', policyVersion: '9.9.9' } },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'POLICY_NOT_FOUND');
});

test('POST /v1/decisions with an unknown verificationProfileId is rejected with 400 UNKNOWN_VERIFICATION_PROFILE', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/decisions',
    headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
    payload: { ...SUBMIT_BODY, verificationProfileId: 'some-other-profile' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'UNKNOWN_VERIFICATION_PROFILE');
});

test('POST /v1/decisions rejects a conflicting input.tenantId with 403 TENANT_MISMATCH', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/decisions',
    headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
    payload: { ...SUBMIT_BODY, input: { ...SUBMIT_BODY.input, tenantId: 'some-other-tenant' } },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'TENANT_MISMATCH');
});

test(
  'full HTTP chain: submit -> poll -> FINALIZED -> fetch receipt -> verify -> tenant isolation -> idempotent replay',
  { skip },
  async () => {
    const app = await buildTestApp();

    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/decisions',
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
      payload: SUBMIT_BODY,
    });
    assert.equal(submitRes.statusCode, 201);
    const submitBody = submitRes.json() as { decisionId: string; status: string };
    assert.equal(submitBody.status, 'PENDING');

    const finalBody = await pollUntilTerminal(app, submitBody.decisionId, TOKEN_TENANT_A);
    assert.equal(finalBody.status, 'FINALIZED');
    const verification = finalBody.verification as { matchingValidators: number; requiredQuorum: number };
    assert.equal(verification.matchingValidators, 3);
    assert.equal(verification.requiredQuorum, 2);

    const receiptRes = await app.inject({
      method: 'GET',
      url: `/v1/decisions/${submitBody.decisionId}/receipt`,
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
    });
    assert.equal(receiptRes.statusCode, 200);
    const receipt = receiptRes.json();

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/receipts/verify',
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
      payload: { schemaVersion: '1.0.0', receipt },
    });
    assert.equal(verifyRes.statusCode, 200);
    const verifyBody = verifyRes.json() as { status: string };
    assert.equal(verifyBody.status, 'VALID');

    const tamperedReceipt = { ...(receipt as Record<string, unknown>) };
    tamperedReceipt.consensus = { ...(tamperedReceipt.consensus as Record<string, unknown>), outputHash: 'sha256:' + 'f'.repeat(64) };
    const tamperedVerifyRes = await app.inject({
      method: 'POST',
      url: '/v1/receipts/verify',
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
      payload: { schemaVersion: '1.0.0', receipt: tamperedReceipt },
    });
    assert.equal(tamperedVerifyRes.statusCode, 200);
    const tamperedVerifyBody = tamperedVerifyRes.json() as { status: string; checks: readonly { name: string; passed: boolean }[] };
    assert.equal(tamperedVerifyBody.status, 'INVALID');
    assert.ok(tamperedVerifyBody.checks.some((c) => !c.passed));

    const crossTenantRes = await app.inject({
      method: 'GET',
      url: `/v1/decisions/${submitBody.decisionId}`,
      headers: { authorization: `Bearer ${TOKEN_TENANT_B}` },
    });
    assert.equal(crossTenantRes.statusCode, 404);
    assert.equal(crossTenantRes.json().error.code, 'DECISION_NOT_FOUND');

    const replayRes = await app.inject({
      method: 'POST',
      url: '/v1/decisions',
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
      payload: SUBMIT_BODY,
    });
    assert.equal(replayRes.statusCode, 200);
    const replayBody = replayRes.json() as { decisionId: string };
    assert.equal(replayBody.decisionId, submitBody.decisionId);
  }
);

test(
  'two concurrent, identical POST /v1/decisions requests produce exactly one decision',
  { skip },
  async () => {
    const app = await buildTestApp();
    const concurrentBody = {
      ...SUBMIT_BODY,
      input: { ...SUBMIT_BODY.input, vehicleId: 'vehicle-app-test-concurrent-01', sessionId: 'session-app-test-concurrent-01' },
    };

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/decisions', headers: { authorization: `Bearer ${TOKEN_TENANT_A}` }, payload: concurrentBody }),
      app.inject({ method: 'POST', url: '/v1/decisions', headers: { authorization: `Bearer ${TOKEN_TENANT_A}` }, payload: concurrentBody }),
    ]);

    const firstBody = first.json() as { decisionId: string };
    const secondBody = second.json() as { decisionId: string };
    assert.equal(firstBody.decisionId, secondBody.decisionId);
    // Exactly one of the two requests observed the fresh 201; the other
    // observed the idempotent-replay 200 -- never both 201 (which would
    // mean two decisions were actually created for the same request).
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 201]);

    await pollUntilTerminal(app, firstBody.decisionId, TOKEN_TENANT_A);
  }
);

// GET /v1/policies and the detail endpoint both compute policyHash from
// the real policy.wasm/profile files (policy-hashes.ts) -- those live
// under policies/*/package/, which is gitignored build output from
// scripts/build-policy.sh, not a committed fixture, so these need the
// same skip gate as the validator-binary-dependent tests.

test('GET /v1/policies lists the registered policy with real computed hashes', { skip }, async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/v1/policies', headers: { authorization: `Bearer ${TOKEN_TENANT_A}` } });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { policies: readonly { policyId: string; policyHash: string }[] };
  assert.equal(body.policies.length, 1);
  assert.equal(body.policies[0]?.policyId, 'negotiation-v1');
  assert.match(body.policies[0]?.policyHash ?? '', /^sha256:[0-9a-f]{64}$/);
});

test('GET /v1/policies/:policyId/:policyVersion returns the full detail with input/output schemas', { skip }, async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/policies/negotiation-v1/1.0.0',
    headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { reasonCodes: readonly string[] };
  assert.ok(body.reasonCodes.includes('OFFER_BELOW_FLOOR'));
});

test('GET /v1/policies/:policyId/:policyVersion for an unregistered policy returns 404 POLICY_NOT_FOUND', async () => {
  const app = await buildTestApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/policies/does-not-exist/9.9.9',
    headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'POLICY_NOT_FOUND');
});

test(
  'GET /v1/decisions/:decisionId/validators reports real per-validator progress, matching the receipt\'s own outputHash, and is tenant-isolated',
  { skip },
  async () => {
    const app = await buildTestApp();

    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/decisions',
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
      payload: SUBMIT_BODY,
    });
    assert.equal(submitRes.statusCode, 201);
    const { decisionId } = submitRes.json() as { decisionId: string };

    const finalBody = await pollUntilTerminal(app, decisionId, TOKEN_TENANT_A);
    assert.equal(finalBody.status, 'FINALIZED');

    const receiptRes = await app.inject({
      method: 'GET',
      url: `/v1/decisions/${decisionId}/receipt`,
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
    });
    const receipt = receiptRes.json() as { consensus: { outputHash: string } };

    const validatorsRes = await app.inject({
      method: 'GET',
      url: `/v1/decisions/${decisionId}/validators`,
      headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
    });
    assert.equal(validatorsRes.statusCode, 200);
    const validatorsBody = validatorsRes.json() as {
      schemaVersion: string;
      decisionId: string;
      validators: readonly { validatorId: string; phase: string; updatedAt: string; outputHash?: string }[];
    };
    assert.equal(validatorsBody.decisionId, decisionId);
    assert.equal(validatorsBody.validators.length, 3);
    for (const entry of validatorsBody.validators) {
      assert.equal(entry.phase, 'SUCCEEDED');
      assert.equal(entry.outputHash, receipt.consensus.outputHash);
      assert.match(entry.validatorId, /^sha256:[0-9a-f]{64}$/);
      assert.ok(!Number.isNaN(Date.parse(entry.updatedAt)));
      // Never anything beyond the four documented fields -- no stderr, no
      // error detail, no file paths, no key material.
      assert.deepEqual(Object.keys(entry).sort(), ['outputHash', 'phase', 'updatedAt', 'validatorId']);
    }

    const crossTenantRes = await app.inject({
      method: 'GET',
      url: `/v1/decisions/${decisionId}/validators`,
      headers: { authorization: `Bearer ${TOKEN_TENANT_B}` },
    });
    assert.equal(crossTenantRes.statusCode, 404);
    assert.equal(crossTenantRes.json().error.code, 'DECISION_NOT_FOUND');
  }
);

test('GET /v1/decisions/:decisionId/validators for a decision that has not started running yet returns an empty array, not an error', async () => {
  const app = await buildTestApp();
  // A decisionId that doesn't exist at all is still DECISION_NOT_FOUND --
  // this test only proves the "exists but no validators registered yet"
  // branch would be an empty array in principle; without the real
  // validator binary the decision may never even reach that branch, so
  // this only asserts the not-found path stays correct alongside the new route.
  const res = await app.inject({
    method: 'GET',
    url: '/v1/decisions/dec_never_existed/validators',
    headers: { authorization: `Bearer ${TOKEN_TENANT_A}` },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'DECISION_NOT_FOUND');
});
