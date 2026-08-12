// SPDX-License-Identifier: Apache-2.0
// Milestone 6: the only two points where a Sha256Digest ("sha256:<64 hex>")
// crosses into/out of Solidity's bytes32 ("0x<64 hex>") representation.
// Everywhere else -- the tree, leaves, proofs, AnchorRecordV1 -- stays in
// sha256: string form.

import type { Sha256Digest } from '@ddn/crypto';

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export class Bytes32ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Bytes32ConversionError';
  }
}

export function sha256DigestToBytes32(digest: Sha256Digest): `0x${string}` {
  if (!SHA256_PATTERN.test(digest)) {
    throw new Bytes32ConversionError(`not a well-formed Sha256Digest: ${digest}`);
  }
  return `0x${digest.slice('sha256:'.length)}`;
}

export function bytes32ToSha256Digest(value: string): Sha256Digest {
  if (!BYTES32_PATTERN.test(value)) {
    throw new Bytes32ConversionError(`not a well-formed bytes32 hex string: ${value}`);
  }
  return `sha256:${value.slice(2).toLowerCase()}` as Sha256Digest;
}
