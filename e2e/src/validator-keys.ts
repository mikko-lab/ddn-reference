// SPDX-License-Identifier: Apache-2.0
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildValidatorSetFromPublicKeyFiles } from '@ddn/coordinator';
import { generateEd25519KeyPair } from '@ddn/crypto';
import type { ValidatorSetV1 } from '@ddn/receipt-sdk';

export interface ValidatorInstancePaths {
  readonly privateKeyFilePath: string;
  readonly publicKeyFilePath: string;
}

/** Generates three fresh Ed25519 identities for this one E2E run. Private
 * keys are created directly as 0600 files under the run's 0700 temporary
 * directory and are removed during teardown. */
export async function writeDemoValidatorKeyFiles(dir: string): Promise<readonly ValidatorInstancePaths[]> {
  const instances: ValidatorInstancePaths[] = [];
  for (const name of ['a', 'b', 'c'] as const) {
    const keyPair = generateEd25519KeyPair();
    const privateKeyFilePath = join(dir, `${name}.key`);
    const publicKeyFilePath = join(dir, `${name}.pub`);
    await writeFile(privateKeyFilePath, keyPair.privateKey, { mode: 0o600, flag: 'wx' });
    await writeFile(publicKeyFilePath, keyPair.publicKey, { flag: 'wx' });
    instances.push({ privateKeyFilePath, publicKeyFilePath });
  }
  return instances;
}

/** Threshold 2 of 3 -- matches TrustedDemoProfileV1's own committed
 * validatorSet.threshold exactly (see packages/demo-trust-profile's
 * generator); a mismatch here would make every real decision's quorum
 * disagree with what the browser's bundled trust profile expects. */
export const DEMO_VALIDATOR_THRESHOLD = 2;

export async function buildDemoValidatorSet(instances: readonly ValidatorInstancePaths[]): Promise<ValidatorSetV1> {
  return buildValidatorSetFromPublicKeyFiles(
    instances.map((i) => i.publicKeyFilePath),
    DEMO_VALIDATOR_THRESHOLD
  );
}
