# Canonical JSON profile v1

`@ddn/canonical-json` (TypeScript) and `ddn-canonical-json` (Rust) implement
an RFC 8785 (JSON Canonicalization Scheme)-based canonicalization, restricted
to a small, explicitly documented data profile. This document is the single
source of truth for that profile; both language implementations, and their
30+ shared test vectors (`packages/test-vectors/vectors/canonical-json-v1.json`),
must match it exactly.

## Data profile

Allowed values:

- `null`
- boolean
- UTF-8 string
- integer within JavaScript's safe integer range (`±(2^53 - 1)`)
- array of allowed values
- object with string keys, values recursively allowed

Rejected, with explicit error codes:

| Code | Meaning |
| --- | --- |
| `UNSUPPORTED_TYPE` | Any JS type outside the profile: `undefined`, function, symbol, `BigInt`, class instances, `Map`/`Set`/`Date`, etc. |
| `NON_FINITE_NUMBER` | `NaN`, `Infinity`, `-Infinity` |
| `NON_INTEGER_NUMBER` | Any number with a fractional component, **or any number literal written with a decimal point or exponent**, even if mathematically a whole number (`1.0`, `1e2`) |
| `UNSAFE_INTEGER` | `\|n\| > Number.MAX_SAFE_INTEGER` |
| `CYCLIC_VALUE` | Reference cycle in the value graph (JS-only — see below) |
| `INVALID_JSON` | Malformed JSON syntax |
| `DUPLICATE_JSON_KEY` | The same object key appears twice in the source text |
| `INVALID_UNICODE` | An unpaired UTF-16 surrogate, in a string value or an object key |

Money is never canonicalized as a decimal — always as an integer number of
cents.

### Why reject `1e2` and `1.0`?

The alternative — evaluating whether an exponential or decimal literal
happens to represent a whole number — adds a class of subtle bugs (locale-
and precision-dependent parsing) for no real benefit inside a network whose
whole point is bit-for-bit determinism. Rejecting by syntax alone (any `.`
or `e`/`E` in the literal) is unambiguous and trivial to implement
identically in two languages.

## Why a hand-rolled parser

Both implementations include a custom recursive-descent JSON parser
(`parseAndCanonicalize` / `parse_and_canonicalize`) instead of using
`JSON.parse` or `serde_json`'s default parser. Neither of those can reject
duplicate object keys — by the time you have a parsed value, the last
duplicate has already silently won — and neither distinguishes `100` from
`1e2` after parsing. Detecting both requires control over the parse itself.

The Rust side's `canonicalize(&serde_json::Value)` entry point (for values
constructed programmatically, not parsed from text) is intentionally
looser: Rust's type system already makes `UNSUPPORTED_TYPE`, `CYCLIC_VALUE`,
and `NON_FINITE_NUMBER` unreachable there (`serde_json::Value` has no
variant for a function or a cycle, and `serde_json::Number` cannot hold
NaN/Infinity). Those error codes exist on the Rust side purely for API
symmetry with TypeScript, and for the text-parsing path
(`parse_and_canonicalize`), where they are all reachable.

## Key ordering

RFC 8785 orders object keys by **UTF-16 code unit** sequence, not by
Unicode code point. These differ for supplementary-plane characters (e.g.
emoji): a code-point comparison treats a character like U+1F600 as one
large value larger than every BMP character, while a UTF-16 comparison
treats it as two surrogate code units in the 0xD800–0xDFFF range, which
sort *among* the BMP characters, not after all of them.

- **TypeScript**: JS strings are natively UTF-16, so `charCodeAt` gives
  code units directly — no encoding step needed.
- **Rust**: strings are UTF-8 with `char`s as Unicode scalar values, so keys
  are re-encoded via `str::encode_utf16()` before comparison. Rust's
  default `String` `Ord` (byte-wise / code-point order) is **not** used —
  it would silently disagree with TypeScript for supplementary-plane keys.

## String escaping and Unicode policy

Only `"`, `\`, and control characters below `0x20` are escaped (using the
short forms `\b \f \n \r \t` where they exist, `\u00XX` otherwise). Every
other character — including the entire non-ASCII range — is emitted as-is,
in UTF-8. **No NFC (or any other) Unicode normalization is applied.**
Canonicalization must not change a string's semantic content; normalizing
would silently conflate strings a caller intended to be distinct.

Lone (unpaired) UTF-16 surrogates are rejected as `INVALID_UNICODE`, in both
strings and object keys. This is stricter than bare RFC 8785 requires, but
consistent: DDN's data profile promises a UTF-8 string, and a lone surrogate
cannot be encoded as valid UTF-8.

## Numbers

Integers only, within `±(9007199254740991)`. Serialized as a plain decimal
literal (optional `-`, no leading zeros except `0` itself, no `+`, no
decimal point, no exponent) on both sides — this is safe because
`Number.prototype.toString()` never switches to exponential notation inside
the safe integer range, and Rust's `i64`/`u64` `Display` never does either.

## Cross-language verification

`packages/test-vectors/vectors/canonical-json-v1.json` holds 33 valid
vectors (empty/nested structures, key-order permutations, Finnish
characters, emoji/surrogate pairs, boundary integers, synthetic
Negotiation Reference-shaped input/output objects) and 17 invalid vectors (one per
error code, plus JSON syntax errors). Both
`packages/canonical-json/ts/src/canonical-json-v1.test.ts` and
`packages/canonical-json/rust/tests/cross_language_vectors.rs` load this
same file and assert: identical canonical string, identical UTF-8 bytes
(via identical SHA-256), and identical error code for the invalid cases.
