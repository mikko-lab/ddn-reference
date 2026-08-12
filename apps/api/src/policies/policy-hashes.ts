// SPDX-License-Identifier: Apache-2.0
// Computes policyHash and profileHash exactly the way ddn-validator does
// (apps/validator/src/lib.rs's load_policy/load_profile) so the API can
// report them without shelling out to the validator binary: policyHash is
// the plain SHA-256 of policy.wasm's bytes, and profileHash is
// hash_canonical_json("DDN_PROFILE_V1", <profile.json content>) -- neither
// depends on any request input, so both can be computed once at boot.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertCanonicalJsonValue } from '@ddn/canonical-json';
import { hashCanonicalJson, sha256Bytes, type Sha256Digest } from '@ddn/crypto';

const PROFILE_HASH_DOMAIN = 'DDN_PROFILE_V1';

export async function computePolicyHash(policyPackagePath: string): Promise<Sha256Digest> {
  const wasmBytes = await readFile(join(policyPackagePath, 'policy.wasm'));
  return sha256Bytes(new Uint8Array(wasmBytes));
}

export async function computeProfileHash(profilePath: string): Promise<Sha256Digest> {
  const raw: unknown = JSON.parse(await readFile(profilePath, 'utf8'));
  assertCanonicalJsonValue(raw);
  return hashCanonicalJson(PROFILE_HASH_DOMAIN, raw);
}
