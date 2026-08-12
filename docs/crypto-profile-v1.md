# Crypto profile v1

`@ddn/crypto` (TypeScript) and `ddn-crypto` (Rust) implement SHA-256 hashing
and Ed25519 signing/verification, matching byte-for-byte across languages.

## Hash algorithm

SHA-256. Output format: `sha256:<lowercase hex>`, e.g.
`sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Signature algorithm

Ed25519.

- **Key/signature encoding: lowercase hex**, not base64url. Both are valid
  per the plan; hex was chosen over base64url specifically to avoid
  padding-and-alphabet edge cases (`-`/`_` vs `+`/`/`, trailing `=`) across
  two independent implementations. One format, used identically everywhere:
  32-byte raw private seed, 32-byte raw public key, 64-byte raw signature,
  each as 64/64/128 lowercase hex characters.
- **Verification mode: `zip215: false` (TypeScript) / `verify_strict`
  (Rust).** Both libraries default to a more permissive verification mode
  (ZIP215-style batch-friendly verification in `@noble/curves`, cofactored
  verification in `ed25519-dalek`); this profile pins both to the stricter
  RFC 8032 semantics instead, so the two implementations agree on
  edge-case signatures (non-canonical `S`, small-order `R`), not just
  well-formed ones.

## Why `@noble/curves` instead of `node:crypto`

`node:crypto`'s Ed25519 support only exposes keys through DER (SPKI/PKCS8)
or JWK wrappers — there is no raw 32-byte import/export path. Reconstructing
a `KeyObject` from a raw seed, or deriving a raw public key from a raw
private seed, means round-tripping through JWK's `d`/`x` fields, and Node
does not reliably synthesize the public key (`x`) from a bare seed (`d`)
alone. That friction is exactly backwards for a profile whose entire point
is a fixed raw-byte encoding shared with Rust.

`@noble/curves` (specifically `@noble/curves/ed25519.js`) operates on raw
byte arrays directly (`keygen()`, `getPublicKey(seed)`, `sign(msg, seed)`,
`verify(sig, msg, pubkey, opts)`), is audited (Cure53) and zero-dependency,
and is widely used in production (viem, ethers v6, and others). This
satisfies "a well-justified audited library" from the plan without writing
custom Ed25519 code.

Rust uses `ed25519-dalek` (`SigningKey`/`VerifyingKey`, raw 32/64-byte
arrays throughout) and `sha2` for hashing — no custom cryptography either.

## Domain separation

Hash inputs are never a raw string concatenation of fields. Two patterns
are used, both via canonical JSON:

1. **Generic envelope** (`hashCanonicalJson(domain, value)` /
   `hash_canonical_json(domain, &value)`): wraps the value as
   `{"domain": domain, "value": value}`, canonicalizes, and hashes the
   result. Used for `inputHash` (`DDN_INPUT_V1`) and `outputHash`
   (`DDN_OUTPUT_V1`).
2. **Flat execution envelope** (`DDN_EXECUTION_V1`): the four hashes that
   make up an execution result are hashed together as siblings of the
   domain field itself:

   ```json
   {
     "domain": "DDN_EXECUTION_V1",
     "inputHash": "sha256:...",
     "policyHash": "sha256:...",
     "profileHash": "sha256:...",
     "outputHash": "sha256:..."
   }
   ```

   This is built and hashed directly (not via the generic wrapper) in
   `apps/validator`, since its structure is fixed and specified, not a
   generic single value needing a domain tag.

## Security notes

- Private keys are never logged.
- Key and signature lengths are validated explicitly before use; a wrong
  length is a controlled error (`Ed25519Error` / `Ed25519Error` in Rust,
  same variant names) rather than an out-of-bounds read.
- `verifyEd25519` / `verify_ed25519` return `false` for a malformed key or
  signature (wrong length, non-hex) rather than throwing — a negotiation
  decision's verifier should be able to treat "malformed" and
  "doesn't verify" the same way (both mean: don't trust this).
- Signing and verification go through the audited libraries' own
  constant-time implementations; no custom timing-sensitive code was
  written here.

## Cross-language verification

`packages/test-vectors/vectors/crypto-v1.json` holds one synthetic Ed25519
keypair (generated for this repository only — not a production key) and a
message. Because Ed25519 signing is deterministic
(no per-signature randomness), `packages/crypto/ts/src/crypto-v1.test.ts`
and `packages/crypto/rust/tests/cross_language_vectors.rs` both re-sign the
same seed+message and assert the result is byte-identical to the recorded
signature — not just that each side's own signature verifies. Both files
also check: a tampered message fails verification, a tampered signature
fails verification, and the wrong public key fails verification.
