// SPDX-License-Identifier: Apache-2.0
// Builds a ValidatorSetV1 from a list of public-key files (the same
// `.pub` files `ddn-validator keygen` writes). The set's own id is always
// derived by @ddn/receipt-sdk's buildValidatorSetV1 from the public keys
// themselves -- never accepted as free-form configuration text.

import { readFile } from 'node:fs/promises';
import { buildValidatorSetV1, type ValidatorSetV1 } from '@ddn/receipt-sdk';

export async function buildValidatorSetFromPublicKeyFiles(
  publicKeyFilePaths: readonly string[],
  threshold: number,
): Promise<ValidatorSetV1> {
  const publicKeys = await Promise.all(publicKeyFilePaths.map(async (filePath) => (await readFile(filePath, 'utf8')).trim()));
  return buildValidatorSetV1({ schemaVersion: '1.0.0', threshold, publicKeys });
}
