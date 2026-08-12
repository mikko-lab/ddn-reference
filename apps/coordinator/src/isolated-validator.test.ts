// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIsolatedValidator } from './isolated-validator.js';

// These tests use tiny standalone Node scripts as stand-ins for
// ddn-validator, purely to exercise runIsolatedValidator's own process
// lifecycle handling (timeout, non-zero exit, stdout/stderr separation)
// without needing a slow/artificially-broken real validator binary --
// isolated-validator.ts itself is protocol-agnostic, it just runs
// `<binary> execute --policy ... --request ... --private-key-file ...`
// and reports back what happened.

async function writeFakeBinary(dir: string, name: string, script: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env node\n${script}`, { mode: 0o755 });
  return path;
}

test('runIsolatedValidator returns SUCCESS with separated stdout/stderr on a normal exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-fakebin-'));
  const bin = await writeFakeBinary(
    dir,
    'fake-validator.js',
    `console.log(JSON.stringify({ ok: true })); console.error('diagnostic line'); process.exit(0);`,
  );
  const outcome = await runIsolatedValidator({
    validatorBinaryPath: bin,
    policyPackagePath: '/does/not/matter/for/this/fake',
    profilePath: undefined,
    requestPath: '/does/not/matter/for/this/fake',
    privateKeyFilePath: '/does/not/matter/for/this/fake',
    timeoutMs: 5000,
  });
  assert.equal(outcome.kind, 'SUCCESS');
  if (outcome.kind === 'SUCCESS') {
    assert.equal(outcome.stdout.trim(), '{"ok":true}');
    assert.equal(outcome.stderr.trim(), 'diagnostic line');
  }
});

test('runIsolatedValidator returns PROCESS_ERROR with the right exit code on a non-zero exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-fakebin-'));
  const bin = await writeFakeBinary(dir, 'fake-validator.js', `console.error('POLICY_HASH_MISMATCH: boom'); process.exit(1);`);
  const outcome = await runIsolatedValidator({
    validatorBinaryPath: bin,
    policyPackagePath: '/x',
    profilePath: undefined,
    requestPath: '/x',
    privateKeyFilePath: '/x',
    timeoutMs: 5000,
  });
  assert.equal(outcome.kind, 'PROCESS_ERROR');
  if (outcome.kind === 'PROCESS_ERROR') {
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.stderr, /POLICY_HASH_MISMATCH/);
  }
});

test('runIsolatedValidator returns TIMEOUT and kills a validator that runs longer than its own timeout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-fakebin-'));
  const bin = await writeFakeBinary(dir, 'fake-validator.js', `setTimeout(() => {}, 60_000);`);
  const outcome = await runIsolatedValidator({
    validatorBinaryPath: bin,
    policyPackagePath: '/x',
    profilePath: undefined,
    requestPath: '/x',
    privateKeyFilePath: '/x',
    timeoutMs: 200,
  });
  assert.equal(outcome.kind, 'TIMEOUT');
});

test('two concurrent isolated validators get two different temp cwds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-fakebin-'));
  const bin = await writeFakeBinary(dir, 'fake-validator.js', `console.log(process.cwd());`);
  const [a, b] = await Promise.all([
    runIsolatedValidator({ validatorBinaryPath: bin, policyPackagePath: '/x', profilePath: undefined, requestPath: '/x', privateKeyFilePath: '/x', timeoutMs: 5000 }),
    runIsolatedValidator({ validatorBinaryPath: bin, policyPackagePath: '/x', profilePath: undefined, requestPath: '/x', privateKeyFilePath: '/x', timeoutMs: 5000 }),
  ]);
  assert.equal(a.kind, 'SUCCESS');
  assert.equal(b.kind, 'SUCCESS');
  if (a.kind === 'SUCCESS' && b.kind === 'SUCCESS') {
    assert.notEqual(a.stdout.trim(), b.stdout.trim());
  }
});
