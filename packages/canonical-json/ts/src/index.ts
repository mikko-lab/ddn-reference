// SPDX-License-Identifier: Apache-2.0
// @ddn/canonical-json
//
// RFC 8785 (JSON Canonicalization Scheme)-based canonicalization, restricted
// to the DDN data profile: null, boolean, UTF-8 string, safe integer, array,
// and object with string keys. See docs/canonical-json-profile-v1.md for the
// full rationale, including the Unicode and duplicate-key policies.

export type CanonicalJsonPrimitive = null | boolean | string | number;

export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export type CanonicalJsonErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'NON_FINITE_NUMBER'
  | 'NON_INTEGER_NUMBER'
  | 'UNSAFE_INTEGER'
  | 'CYCLIC_VALUE'
  | 'INVALID_JSON'
  | 'DUPLICATE_JSON_KEY'
  | 'INVALID_UNICODE';

export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode;

  constructor(code: CanonicalJsonErrorCode, message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
    this.code = code;
  }
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;

// Matches a single unpaired UTF-16 surrogate: a high surrogate not followed
// by a low surrogate, or a low surrogate not preceded by a high surrogate.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

function hasLoneSurrogate(value: string): boolean {
  return LONE_SURROGATE.test(value);
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates that `value` conforms to the DDN canonical JSON data profile.
 * Throws {@link CanonicalJsonError} with an explicit code on the first
 * violation found. Cycle detection walks the reference graph with a
 * per-branch ancestor set.
 */
export function assertCanonicalJsonValue(value: unknown): asserts value is CanonicalJsonValue {
  walk(value, new Set<object>());
}

function walk(value: unknown, ancestors: Set<object>): void {
  if (value === null) return;

  const type = typeof value;

  if (type === 'boolean') return;

  if (type === 'string') {
    if (hasLoneSurrogate(value as string)) {
      throw new CanonicalJsonError('INVALID_UNICODE', 'string contains an unpaired UTF-16 surrogate');
    }
    return;
  }

  if (type === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new CanonicalJsonError('NON_FINITE_NUMBER', 'number must be finite (NaN/Infinity are not allowed)');
    }
    if (!Number.isInteger(n)) {
      throw new CanonicalJsonError('NON_INTEGER_NUMBER', 'number must be an integer (no fractional component)');
    }
    if (n > MAX_SAFE_INTEGER || n < MIN_SAFE_INTEGER) {
      throw new CanonicalJsonError('UNSAFE_INTEGER', 'integer is outside the safe integer range');
    }
    return;
  }

  if (type !== 'object') {
    throw new CanonicalJsonError('UNSUPPORTED_TYPE', `unsupported value type: ${type}`);
  }

  const obj = value as object;

  if (ancestors.has(obj)) {
    throw new CanonicalJsonError('CYCLIC_VALUE', 'value graph contains a cycle');
  }

  if (Array.isArray(obj)) {
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(obj);
    for (const element of obj) {
      walk(element, nextAncestors);
    }
    return;
  }

  if (!isPlainObject(obj)) {
    throw new CanonicalJsonError('UNSUPPORTED_TYPE', 'objects must be plain (no class instances, Map, Set, Date, etc.)');
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(obj);
  for (const key of Object.keys(obj)) {
    if (hasLoneSurrogate(key)) {
      throw new CanonicalJsonError('INVALID_UNICODE', 'object key contains an unpaired UTF-16 surrogate');
    }
    walk((obj as Record<string, unknown>)[key], nextAncestors);
  }
}

/** UTF-16 code unit comparator, matching RFC 8785 §3.2.3 key ordering. */
function compareUtf16(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}

function escapeString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const ch = value[i] as string;
    switch (ch) {
      case '"':
        out += '\\"';
        continue;
      case '\\':
        out += '\\\\';
        continue;
      case '\b':
        out += '\\b';
        continue;
      case '\f':
        out += '\\f';
        continue;
      case '\n':
        out += '\\n';
        continue;
      case '\r':
        out += '\\r';
        continue;
      case '\t':
        out += '\\t';
        continue;
    }
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    // All other code units, including the full non-ASCII range, are kept
    // as-is: no NFC normalization, no forced \uXXXX escaping. See
    // docs/canonical-json-profile-v1.md for why.
    out += ch;
  }
  return out + '"';
}

function serialize(value: CanonicalJsonValue): string {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'string') return escapeString(value as string);
  if (type === 'number') return String(value);
  if (Array.isArray(value)) {
    return '[' + value.map(serialize).join(',') + ']';
  }
  const obj = value as { readonly [key: string]: CanonicalJsonValue };
  const keys = Object.keys(obj).sort(compareUtf16);
  return (
    '{' +
    keys.map((key) => escapeString(key) + ':' + serialize(obj[key] as CanonicalJsonValue)).join(',') +
    '}'
  );
}

export function canonicalize(value: CanonicalJsonValue): string {
  assertCanonicalJsonValue(value);
  return serialize(value);
}

export function canonicalizeUtf8(value: CanonicalJsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

// ---------------------------------------------------------------------------
// parseAndCanonicalize: a hand-rolled recursive-descent JSON parser.
//
// This exists because native JSON.parse() silently collapses duplicate
// object keys (keeping only the last one) and has no way to distinguish
// "1e2" from "100" after the fact. Both matter for a canonicalization
// profile that must reject duplicate keys and non-integer number literals
// by syntax, not by re-inspecting an already-collapsed value.
// ---------------------------------------------------------------------------

class Parser {
  private readonly text: string;
  private pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  parse(): CanonicalJsonValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos !== this.text.length) {
      this.fail('unexpected trailing content after top-level value');
    }
    return value;
  }

  private fail(message: string): never {
    throw new CanonicalJsonError('INVALID_JSON', `${message} at position ${this.pos}`);
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const c = this.text[this.pos] as string;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private expect(char: string): void {
    if (this.text[this.pos] !== char) {
      this.fail(`expected '${char}'`);
    }
    this.pos++;
  }

  private parseValue(): CanonicalJsonValue {
    const c = this.peek();
    if (c === undefined) this.fail('unexpected end of input');
    if (c === '{') return this.parseObject();
    if (c === '[') return this.parseArray();
    if (c === '"') return this.parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return this.parseNumber();
    if (this.text.startsWith('true', this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith('false', this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.text.startsWith('null', this.pos)) {
      this.pos += 4;
      return null;
    }
    this.fail(`unexpected character '${c}'`);
  }

  private parseObject(): { [key: string]: CanonicalJsonValue } {
    this.expect('{');
    const result: { [key: string]: CanonicalJsonValue } = {};
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') this.fail('expected object key string');
      const key = this.parseString();
      if (seen.has(key)) {
        throw new CanonicalJsonError('DUPLICATE_JSON_KEY', `duplicate object key: ${key}`);
      }
      seen.add(key);
      this.skipWhitespace();
      this.expect(':');
      this.skipWhitespace();
      const value = this.parseValue();
      result[key] = value;
      this.skipWhitespace();
      const c = this.peek();
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === '}') {
        this.pos++;
        return result;
      }
      this.fail("expected ',' or '}'");
    }
  }

  private parseArray(): CanonicalJsonValue[] {
    this.expect('[');
    const result: CanonicalJsonValue[] = [];
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.parseValue());
      this.skipWhitespace();
      const c = this.peek();
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === ']') {
        this.pos++;
        return result;
      }
      this.fail("expected ',' or ']'");
    }
  }

  private parseString(): string {
    this.expect('"');
    let out = '';
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) this.fail('unterminated string');
      if (c === '"') {
        this.pos++;
        if (hasLoneSurrogate(out)) {
          throw new CanonicalJsonError('INVALID_UNICODE', 'string contains an unpaired UTF-16 surrogate');
        }
        return out;
      }
      if (c === '\\') {
        this.pos++;
        const esc = this.text[this.pos];
        if (esc === undefined) this.fail('unterminated escape sequence');
        switch (esc) {
          case '"':
            out += '"';
            this.pos++;
            break;
          case '\\':
            out += '\\';
            this.pos++;
            break;
          case '/':
            out += '/';
            this.pos++;
            break;
          case 'b':
            out += '\b';
            this.pos++;
            break;
          case 'f':
            out += '\f';
            this.pos++;
            break;
          case 'n':
            out += '\n';
            this.pos++;
            break;
          case 'r':
            out += '\r';
            this.pos++;
            break;
          case 't':
            out += '\t';
            this.pos++;
            break;
          case 'u': {
            const hexDigits = this.text.slice(this.pos + 1, this.pos + 5);
            if (hexDigits.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hexDigits)) {
              this.fail('invalid \\u escape');
            }
            out += String.fromCharCode(parseInt(hexDigits, 16));
            this.pos += 5;
            break;
          }
          default:
            this.fail(`invalid escape character '${esc}'`);
        }
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        this.fail('control character in string must be escaped');
      }
      out += c;
      this.pos++;
    }
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.peek() === '-') this.pos++;
    if (this.peek() === '0') {
      this.pos++;
    } else if (this.peek() !== undefined && this.peek()! >= '1' && this.peek()! <= '9') {
      while (this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9') this.pos++;
    } else {
      this.fail('invalid number literal');
    }

    let isInteger = true;

    if (this.peek() === '.') {
      isInteger = false;
      this.pos++;
      if (!(this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9')) {
        this.fail('invalid number literal: expected digit after decimal point');
      }
      while (this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9') this.pos++;
    }

    if (this.peek() === 'e' || this.peek() === 'E') {
      isInteger = false;
      this.pos++;
      const sign = this.peek();
      if (sign === '+' || sign === '-') this.pos++;
      if (!(this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9')) {
        this.fail('invalid number literal: expected digit in exponent');
      }
      while (this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9') this.pos++;
    }

    const text = this.text.slice(start, this.pos);

    if (!isInteger) {
      // Syntactically valid JSON number, but outside the DDN integer-only
      // profile. This is deliberate: "1e2" is rejected as non-integer even
      // though it is mathematically whole, so the profile never has to
      // evaluate exponents to decide validity. See
      // docs/canonical-json-profile-v1.md.
      throw new CanonicalJsonError('NON_INTEGER_NUMBER', `number literal is not a plain integer: ${text}`);
    }

    const value = Number(text);
    if (value > MAX_SAFE_INTEGER || value < MIN_SAFE_INTEGER) {
      throw new CanonicalJsonError('UNSAFE_INTEGER', `integer literal is outside the safe integer range: ${text}`);
    }
    return value;
  }
}

export function parseAndCanonicalize(jsonText: string): {
  value: CanonicalJsonValue;
  canonical: string;
} {
  const value = new Parser(jsonText).parse();
  return { value, canonical: serialize(value) };
}
