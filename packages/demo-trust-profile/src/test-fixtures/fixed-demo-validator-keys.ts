// SPDX-License-Identifier: Apache-2.0
// TEST-ONLY / NEVER USE IN PRODUCTION.
//
// Three fixed, hardcoded Ed25519 keypairs used solely to reproduce the
// committed golden TrustedDemoProfileV1. Runtime demos and E2E runs must
// generate fresh keys for every run and must not import this module.
// stack's three validator processes. Generated once with @ddn/crypto's
// generateEd25519KeyPair and frozen here -- never regenerated at demo
// boot, matching apps/coordinator's own GOLDEN_VECTOR_KEYS precedent for
// fixed, labeled-synthetic keys committed directly in source.
//
// Demo-only keys with no value outside a local Anvil/loopback stack.
// Never reuse them for anything that touches a real network, and never
// derive TrustedDemoProfileV1 from anything but the public keys below --
// the private keys must never appear in that (publicly bundled) artifact.

export interface DemoValidatorKeyPair {
  readonly privateKey: string;
  readonly publicKey: string;
}

export const DEMO_VALIDATOR_KEYS: Readonly<Record<'a' | 'b' | 'c', DemoValidatorKeyPair>> = {
  a: {
    privateKey: '8eaca500be0ce626662fb7b70a93871ea688d684f13b8a53f037ade33bedf84c',
    publicKey: '9b66e37709ee1d808cc93e000452e6e780a10578866658ca363cc9399dd21aed',
  },
  b: {
    privateKey: 'fc1b07163f99b940b5194049b554b8e017feee485049fb835c8a8ace89d63215',
    publicKey: 'a75e1e0de58b51237b869bcb871251f8f80d330dbb65c040b4f20b568761fbbd',
  },
  c: {
    privateKey: '6d1525c38ba70748dda64a1567d7a87a87d29525b18e9ac69d603bef70a212d4',
    publicKey: '584e35e50cad971fc3f931bf3d8dd969a8e5604cd130c5eb7d7079378fea2c84',
  },
};
