// SPDX-License-Identifier: Apache-2.0
// TEST-ONLY / NEVER USE IN PRODUCTION.
//
// Golden protocol vectors for DecisionReceiptV1 --
// packages/test-vectors/vectors/decision-receipt-v1/. Committed,
// byte-for-byte artifacts a TypeScript test compares live recomputation
// against, generated once from three FIXED synthetic validator keypairs
// (never randomly generated per run) and the real, pinned Rust
// `ddn-validator` binary -- so these vectors prove Rust-produced
// signatures verify in TypeScript without any transformation. See
// docs/decision-receipt-v1.md.
//
// Only ever (re)written by `ddn-coordinator generate-golden-vectors
// --confirm-update`; never run by CI.

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalizeUtf8 } from '@ddn/canonical-json';
import {
  buildDecisionReceipt,
  buildValidatorSetV1,
  computeReceiptId,
  computeValidatorSetId,
  parseExecutionRequestV1,
  parseSignedValidatorResultV1,
  selectQuorum,
  type ExecutionRequestV1,
  type SignedValidatorResultV1,
  type ValidatorSetV1,
} from '@ddn/receipt-sdk';

const execFileAsync = promisify(execFile);

// Fixed synthetic Ed25519 test keypairs -- not production keys. Used only
// so these golden vectors are reproducible: regenerating them always signs
// with these same three keys, in this fixed order (A, B, C).
export const GOLDEN_VECTOR_KEYS = {
  a: { privateKey: '3c65a986243eeb79a21ce4992ba0fa1e54f077d5689de47e64571e6a0f373e79', publicKey: 'ae97d90d2a92da0254825e8fd1bf2ad3096a7ac5bcf67a38e61b22a66a97381e' },
  b: { privateKey: '3d969967a0a57140b3f74c39136cf686833e42c05de0c2e4f5acb3798977c102', publicKey: 'cb3065d80f1e2ced6c8c8bdf66cb7809fa384fef4566de4c9b4110919dc23e4b' },
  c: { privateKey: '8517877fb4e3a4be98c9bdb26ca9f4d483adcacdd9eebc6b2b19aa50d3197aac', publicKey: '95e8bb3978993937bb170e0120be891861b8d90c7430c470909a4f63e83d4180' },
} as const;

export const GOLDEN_VECTOR_REQUEST_ID = 'req-decision-receipt-golden-vector-1';
export const GOLDEN_VECTOR_THRESHOLD = 2;

export interface GenerateGoldenVectorsConfig {
  readonly validatorBinaryPath: string;
  readonly policyPackagePath: string;
  readonly inputPath: string;
  readonly outDir: string;
}

export interface GoldenVectorArtifacts {
  readonly request: ExecutionRequestV1;
  readonly validatorSet: ValidatorSetV1;
  readonly signedResults: Record<'a' | 'b' | 'c', SignedValidatorResultV1>;
  readonly receipt: ReturnType<typeof buildDecisionReceipt>;
}

async function runValidator(validatorBinaryPath: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(validatorBinaryPath, [...args]);
  return stdout;
}

/** Generates the full golden vector set: builds one ExecutionRequestV1,
 * executes and signs it with the three fixed keys via the real
 * ddn-validator binary, then assembles and writes every committed
 * artifact. Does not write anything unless `outDir` is provided by the
 * caller with clear intent -- see the CLI's `--confirm-update` gate. */
export async function generateGoldenVectorArtifacts(config: GenerateGoldenVectorsConfig): Promise<GoldenVectorArtifacts> {
  const requestJson = await runValidator(config.validatorBinaryPath, [
    'build-request',
    '--policy',
    config.policyPackagePath,
    '--input',
    config.inputPath,
    '--request-id',
    GOLDEN_VECTOR_REQUEST_ID,
  ]);
  const request = parseExecutionRequestV1(JSON.parse(requestJson));

  const validatorSet = buildValidatorSetV1({
    schemaVersion: '1.0.0',
    threshold: GOLDEN_VECTOR_THRESHOLD,
    publicKeys: [GOLDEN_VECTOR_KEYS.a.publicKey, GOLDEN_VECTOR_KEYS.b.publicKey, GOLDEN_VECTOR_KEYS.c.publicKey],
  });

  const tempDir = await mkdtemp(join(tmpdir(), 'ddn-coordinator-golden-vectors-'));
  const requestPath = join(tempDir, 'request.json');
  await writeFile(requestPath, requestJson);

  const signedResults = {} as Record<'a' | 'b' | 'c', SignedValidatorResultV1>;
  for (const key of ['a', 'b', 'c'] as const) {
    const keyFile = join(tempDir, `${key}.key`);
    await writeFile(keyFile, GOLDEN_VECTOR_KEYS[key].privateKey);
    await chmod(keyFile, 0o600);
    const stdout = await runValidator(config.validatorBinaryPath, [
      'execute',
      '--policy',
      config.policyPackagePath,
      '--request',
      requestPath,
      '--private-key-file',
      keyFile,
    ]);
    signedResults[key] = parseSignedValidatorResultV1(JSON.parse(stdout));
  }

  const quorum = selectQuorum(Object.values(signedResults), request, validatorSet);
  if (quorum.outcome !== 'QUORUM_REACHED') {
    throw new Error(`golden vector generation expected QUORUM_REACHED, got ${quorum.outcome}`);
  }
  const receipt = buildDecisionReceipt(request, validatorSet, quorum);

  return { request, validatorSet, signedResults, receipt };
}

export async function writeGoldenVectorArtifacts(outDir: string, artifacts: GoldenVectorArtifacts): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const write = (name: string, content: string) => writeFile(join(outDir, name), content);

  await write('validator-set.json', JSON.stringify(artifacts.validatorSet, null, 2));
  await write('signed-result-validator-a.json', JSON.stringify(artifacts.signedResults.a, null, 2));
  await write('signed-result-validator-b.json', JSON.stringify(artifacts.signedResults.b, null, 2));
  await write('signed-result-validator-c.json', JSON.stringify(artifacts.signedResults.c, null, 2));
  await write('decision-receipt.json', JSON.stringify(artifacts.receipt, null, 2));

  await writeFile(join(outDir, 'canonical-validator-set.txt'), canonicalizeUtf8(artifacts.validatorSet as never));
  await writeFile(join(outDir, 'canonical-receipt.txt'), canonicalizeUtf8(artifacts.receipt as never));

  await write('validator-set-id.txt', computeValidatorSetId(artifacts.validatorSet));
  const { receiptId, ...receiptContent } = artifacts.receipt;
  await write('receipt-id.txt', computeReceiptId(receiptContent));
  if (receiptId !== computeReceiptId(receiptContent)) {
    throw new Error('internal error: generated receipt.receiptId does not match its own recomputed id');
  }
}
