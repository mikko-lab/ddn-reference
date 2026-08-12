// SPDX-License-Identifier: Apache-2.0
// Loads a ValidatorSetV1 from disk and refuses to use it if its own
// validatorSetId doesn't match what's independently recomputed from its
// content -- the same "never trust a self-declared hash" rule
// apps/coordinator/src/cli.ts already applies, reused here rather than
// re-derived.

import { readFile } from 'node:fs/promises';
import { computeValidatorSetId, parseValidatorSetV1, type ValidatorSetV1 } from '@ddn/receipt-sdk';

export class ValidatorSetLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidatorSetLoadError';
  }
}

export async function loadTrustedValidatorSet(filePath: string): Promise<ValidatorSetV1> {
  const raw = JSON.parse(await readFile(filePath, 'utf8'));
  const validatorSet = parseValidatorSetV1(raw);
  const recomputed = computeValidatorSetId(validatorSet);
  if (recomputed !== validatorSet.validatorSetId) {
    throw new ValidatorSetLoadError(
      `${filePath}: validatorSetId does not match its own content (claimed ${validatorSet.validatorSetId}, recomputed ${recomputed}) -- refusing to use it`
    );
  }
  return validatorSet;
}
