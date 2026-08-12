// SPDX-License-Identifier: Apache-2.0
// Milestone 7: the single, versioned trust anchor apps/explorer's public
// verifier bundles at build time. Contains only public information -- a
// ValidatorSetV1 (public keys only), the local demo chain's chainId, and
// the DecisionAnchor.sol contract address the demo deploys to
// deterministically. Never contains a private key.
//
// Generated only by generate-trusted-demo-profile.ts's --confirm-update
// (see that file), committed to profile/trusted-demo-profile.json, and
// never regenerated or overridden automatically at demo boot -- there is
// no user-supplied trust-profile override in M7. See docs/public-demo-boundary.md.
//
// Deliberately carries no generation timestamp: git history (blame/commit
// date on profile/trusted-demo-profile.json) is already the audit trail
// for when this was last regenerated, and an extra timestamp field would
// only make --check's exact-match comparison spuriously fail on every run.

import { parseValidatorSetV1, type ValidatorSetV1 } from '@ddn/receipt-sdk';

export interface TrustedDemoProfileChainV1 {
  readonly chainId: number;
  readonly contractAddress: string;
}

export interface TrustedDemoProfileV1 {
  readonly schemaVersion: '1.0.0';
  readonly validatorSet: ValidatorSetV1;
  readonly chain: TrustedDemoProfileChainV1;
}

export type TrustedDemoProfileErrorCode = 'INVALID_SHAPE' | 'UNKNOWN_FIELD' | 'INVALID_FIELD';

export class TrustedDemoProfileError extends Error {
  readonly code: TrustedDemoProfileErrorCode;

  constructor(code: TrustedDemoProfileErrorCode, message: string) {
    super(message);
    this.name = 'TrustedDemoProfileError';
    this.code = code;
  }
}

const TOP_LEVEL_FIELDS = ['schemaVersion', 'validatorSet', 'chain'] as const;
const CHAIN_FIELDS = ['chainId', 'contractAddress'] as const;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function parseChain(value: unknown): TrustedDemoProfileChainV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TrustedDemoProfileError('INVALID_SHAPE', 'TrustedDemoProfileV1.chain must be a JSON object');
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(CHAIN_FIELDS as readonly string[]).includes(key)) {
      throw new TrustedDemoProfileError('UNKNOWN_FIELD', `TrustedDemoProfileV1.chain has an unrecognized field: ${key}`);
    }
  }
  if (!Number.isInteger(obj.chainId) || (obj.chainId as number) < 1) {
    throw new TrustedDemoProfileError('INVALID_FIELD', 'TrustedDemoProfileV1.chain.chainId must be a positive integer');
  }
  if (typeof obj.contractAddress !== 'string' || !EVM_ADDRESS_PATTERN.test(obj.contractAddress)) {
    throw new TrustedDemoProfileError('INVALID_FIELD', 'TrustedDemoProfileV1.chain.contractAddress must match 0x<40 hex>');
  }
  return { chainId: obj.chainId as number, contractAddress: obj.contractAddress };
}

/** Parses and validates a `TrustedDemoProfileV1`, rejecting unknown fields
 * at every level. Does NOT check that `validatorSet.validatorSetId`
 * matches its own content -- call `computeValidatorSetId` (re-exported
 * from @ddn/receipt-sdk) separately for that, same "malformed" vs.
 * "tampered" split as `parseValidatorSetV1` itself. */
export function parseTrustedDemoProfileV1(value: unknown): TrustedDemoProfileV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TrustedDemoProfileError('INVALID_SHAPE', 'TrustedDemoProfileV1 must be a JSON object');
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(TOP_LEVEL_FIELDS as readonly string[]).includes(key)) {
      throw new TrustedDemoProfileError('UNKNOWN_FIELD', `TrustedDemoProfileV1 has an unrecognized field: ${key}`);
    }
  }
  if (obj.schemaVersion !== '1.0.0') {
    throw new TrustedDemoProfileError('INVALID_FIELD', "TrustedDemoProfileV1.schemaVersion must be '1.0.0'");
  }
  let validatorSet: ValidatorSetV1;
  try {
    validatorSet = parseValidatorSetV1(obj.validatorSet);
  } catch (error) {
    throw new TrustedDemoProfileError(
      'INVALID_FIELD',
      `TrustedDemoProfileV1.validatorSet is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return {
    schemaVersion: '1.0.0',
    validatorSet,
    chain: parseChain(obj.chain),
  };
}
