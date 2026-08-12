#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// ddn-coordinator CLI: build-validator-set, decide, verify-receipt.
// See docs/decision-receipt-v1.md.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  computeValidatorSetId,
  parseExecutionRequestV1,
  parseValidatorSetV1,
  verifyDecisionReceipt,
  type ValidatorSetV1,
} from '@ddn/receipt-sdk';
import { buildValidatorSetFromPublicKeyFiles } from './build-validator-set.js';
import { decide } from './decide.js';
import { generateGoldenVectorArtifacts, writeGoldenVectorArtifacts } from './test-fixtures/golden-vectors.js';

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** Loads a `ValidatorSetV1` from disk and refuses to proceed if its own
 * `validatorSetId` doesn't match what's independently recomputed from its
 * content -- the same "never trust a self-declared hash" rule the Rust
 * validator applies to manifest/policy hashes. */
async function loadTrustedValidatorSet(filePath: string): Promise<ValidatorSetV1> {
  const validatorSet = parseValidatorSetV1(await readJsonFile(filePath));
  const recomputed = computeValidatorSetId(validatorSet);
  if (recomputed !== validatorSet.validatorSetId) {
    throw new Error(
      `${filePath}: validatorSetId does not match its own content (claimed ${validatorSet.validatorSetId}, recomputed ${recomputed}) -- refusing to use it`,
    );
  }
  return validatorSet;
}

async function runBuildValidatorSet(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'public-key-file': { type: 'string', multiple: true, default: [] },
      threshold: { type: 'string' },
    },
  });
  const publicKeyFiles = values['public-key-file'];
  if (publicKeyFiles.length === 0) {
    throw new Error('at least one --public-key-file is required');
  }
  const threshold = Number.parseInt(values.threshold ?? '', 10);
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error('--threshold must be a positive integer');
  }
  const validatorSet = await buildValidatorSetFromPublicKeyFiles(publicKeyFiles, threshold);
  console.log(JSON.stringify(validatorSet, null, 2));
}

async function runDecide(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'validator-bin': { type: 'string' },
      policy: { type: 'string' },
      profile: { type: 'string' },
      request: { type: 'string' },
      'validator-set': { type: 'string' },
      'private-key-file': { type: 'string', multiple: true, default: [] },
      'public-key-file': { type: 'string', multiple: true, default: [] },
      'timeout-ms': { type: 'string', default: '30000' },
    },
  });

  for (const required of ['validator-bin', 'policy', 'request', 'validator-set'] as const) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  const privateKeyFiles = values['private-key-file'];
  const publicKeyFiles = values['public-key-file'];
  if (privateKeyFiles.length === 0) {
    throw new Error('at least one --private-key-file/--public-key-file pair is required');
  }
  if (privateKeyFiles.length !== publicKeyFiles.length) {
    throw new Error('--private-key-file and --public-key-file must be given the same number of times, in corresponding order');
  }

  const requestPath = resolve(values.request as string);
  const request = parseExecutionRequestV1(await readJsonFile(requestPath));
  const validatorSet = await loadTrustedValidatorSet(values['validator-set'] as string);

  // Every path handed to an isolated validator process must be absolute:
  // each instance runs with its own temp directory as cwd (see
  // isolated-validator.ts), so a relative path would resolve against the
  // wrong directory instead of failing loudly -- resolved here, once, so
  // every instance sees the same, correct, absolute paths regardless of
  // where this CLI itself was invoked from.
  const validatorInstances = await Promise.all(
    privateKeyFiles.map(async (privateKeyFilePath, index) => ({
      privateKeyFilePath: resolve(privateKeyFilePath),
      publicKeyHex: (await readFile(publicKeyFiles[index] as string, 'utf8')).trim(),
    })),
  );

  const timeoutMs = Number.parseInt(values['timeout-ms'], 10);
  const outcome = await decide({
    validatorBinaryPath: resolve(values['validator-bin'] as string),
    policyPackagePath: resolve(values.policy as string),
    profilePath: values.profile !== undefined ? resolve(values.profile) : undefined,
    request,
    requestPath,
    validatorSet,
    validatorInstances,
    timeoutMs,
  });

  console.log(
    JSON.stringify(
      {
        status: outcome.receipt ? 'QUORUM_REACHED' : (outcome.failure?.reason ?? 'UNKNOWN'),
        receipt: outcome.receipt,
        failure: outcome.failure,
        validatorDiagnostics: outcome.perValidatorDiagnostics,
      },
      null,
      2,
    ),
  );
  process.exitCode = outcome.receipt ? 0 : 1;
}

async function runVerifyReceipt(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'validator-set': { type: 'string' },
      receipt: { type: 'string' },
    },
  });
  if (!values['validator-set']) throw new Error('--validator-set is required');
  if (!values.receipt) throw new Error('--receipt is required');

  const validatorSet = await loadTrustedValidatorSet(values['validator-set']);
  const receiptRaw = await readJsonFile(values.receipt);
  const report = verifyDecisionReceipt(receiptRaw, validatorSet);
  console.log(JSON.stringify({ status: report.ok ? 'RECEIPT_OK' : 'RECEIPT_INVALID', checks: report.checks }, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

/** Regenerates the committed golden vectors under
 * packages/test-vectors/vectors/decision-receipt-v1/. Requires
 * --confirm-update -- there is no argument-less shorthand -- and must
 * never be run by CI: these vectors are a fixed, git-reviewed artifact
 * that tests compare *against*, not something regenerated on every run.
 * See docs/decision-receipt-v1.md. */
async function runGenerateGoldenVectors(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'validator-bin': { type: 'string' },
      policy: { type: 'string' },
      input: { type: 'string' },
      'out-dir': { type: 'string' },
      'confirm-update': { type: 'boolean', default: false },
    },
  });
  if (!values['confirm-update']) {
    throw new Error(
      'refusing to (re)generate golden vectors without --confirm-update -- these are a committed, git-reviewed artifact, not a build output',
    );
  }
  for (const required of ['validator-bin', 'policy', 'input', 'out-dir'] as const) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  const artifacts = await generateGoldenVectorArtifacts({
    validatorBinaryPath: resolve(values['validator-bin'] as string),
    policyPackagePath: resolve(values.policy as string),
    inputPath: resolve(values.input as string),
    outDir: resolve(values['out-dir'] as string),
  });
  await writeGoldenVectorArtifacts(resolve(values['out-dir'] as string), artifacts);
  console.log(
    JSON.stringify(
      {
        status: 'GOLDEN_VECTORS_WRITTEN',
        outDir: values['out-dir'],
        validatorSetId: artifacts.validatorSet.validatorSetId,
        receiptId: artifacts.receipt.receiptId,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'build-validator-set':
      return runBuildValidatorSet(rest);
    case 'decide':
      return runDecide(rest);
    case 'verify-receipt':
      return runVerifyReceipt(rest);
    case 'generate-golden-vectors':
      return runGenerateGoldenVectors(rest);
    default:
      console.error(
        `Unknown command: ${String(command)}. Expected one of: build-validator-set, decide, verify-receipt, generate-golden-vectors.`,
      );
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
