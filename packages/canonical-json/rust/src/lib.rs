// SPDX-License-Identifier: Apache-2.0
//! `ddn-canonical-json`: RFC 8785 (JSON Canonicalization Scheme)-based
//! canonicalization, restricted to the DDN data profile: null, boolean,
//! UTF-8 string, safe integer, array, and object with string keys. Mirrors
//! `@ddn/canonical-json` on the TypeScript side. See
//! `docs/canonical-json-profile-v1.md` for the full rationale, including
//! platform differences noted below.

use serde_json::{Map, Number, Value};
use std::fmt;

pub const PACKAGE_NAME: &str = "ddn-canonical-json";

/// JS's `Number.MAX_SAFE_INTEGER` / `MIN_SAFE_INTEGER`. The DDN profile
/// restricts integers to this range on both languages so that money-as-cents
/// values round-trip identically through TypeScript's `number` type.
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MIN_SAFE_INTEGER: i64 = -9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonicalJsonError {
    /// Reachable only via `parse_and_canonicalize` on this platform: Rust's
    /// `serde_json::Value` has no variant that can represent a function,
    /// symbol, or similar, so this can't occur for `canonicalize(&Value)`.
    UnsupportedType(String),
    /// Reachable only via `parse_and_canonicalize`: `serde_json::Number`
    /// cannot hold NaN/Infinity, so `canonicalize(&Value)` can never
    /// observe a non-finite number either.
    NonFiniteNumber(String),
    NonIntegerNumber(String),
    UnsafeInteger(String),
    /// Reachable only via TypeScript: `serde_json::Value` is an owned tree
    /// with no reference cycles, so this variant exists for API symmetry
    /// but cannot be constructed on the Rust side.
    CyclicValue(String),
    InvalidJson(String),
    DuplicateJsonKey(String),
    InvalidUnicode(String),
}

impl CanonicalJsonError {
    /// Stable machine-readable code, identical to the TypeScript side's
    /// `CanonicalJsonError.code`.
    pub fn code(&self) -> &'static str {
        match self {
            CanonicalJsonError::UnsupportedType(_) => "UNSUPPORTED_TYPE",
            CanonicalJsonError::NonFiniteNumber(_) => "NON_FINITE_NUMBER",
            CanonicalJsonError::NonIntegerNumber(_) => "NON_INTEGER_NUMBER",
            CanonicalJsonError::UnsafeInteger(_) => "UNSAFE_INTEGER",
            CanonicalJsonError::CyclicValue(_) => "CYCLIC_VALUE",
            CanonicalJsonError::InvalidJson(_) => "INVALID_JSON",
            CanonicalJsonError::DuplicateJsonKey(_) => "DUPLICATE_JSON_KEY",
            CanonicalJsonError::InvalidUnicode(_) => "INVALID_UNICODE",
        }
    }

    fn message(&self) -> &str {
        match self {
            CanonicalJsonError::UnsupportedType(m)
            | CanonicalJsonError::NonFiniteNumber(m)
            | CanonicalJsonError::NonIntegerNumber(m)
            | CanonicalJsonError::UnsafeInteger(m)
            | CanonicalJsonError::CyclicValue(m)
            | CanonicalJsonError::InvalidJson(m)
            | CanonicalJsonError::DuplicateJsonKey(m)
            | CanonicalJsonError::InvalidUnicode(m) => m,
        }
    }
}

impl fmt::Display for CanonicalJsonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for CanonicalJsonError {}

/// Validates `value` against the DDN canonical JSON data profile.
fn validate(value: &Value) -> Result<(), CanonicalJsonError> {
    match value {
        Value::Null | Value::Bool(_) => Ok(()),
        Value::String(_) => Ok(()),
        Value::Number(n) => validate_number(n),
        Value::Array(items) => {
            for item in items {
                validate(item)?;
            }
            Ok(())
        }
        Value::Object(map) => {
            for (_, v) in map {
                validate(v)?;
            }
            Ok(())
        }
    }
}

fn validate_number(n: &Number) -> Result<(), CanonicalJsonError> {
    if let Some(i) = n.as_i64() {
        if !(MIN_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&i) {
            return Err(CanonicalJsonError::UnsafeInteger(format!(
                "integer is outside the safe integer range: {i}"
            )));
        }
        return Ok(());
    }
    if let Some(u) = n.as_u64() {
        if u > MAX_SAFE_INTEGER as u64 {
            return Err(CanonicalJsonError::UnsafeInteger(format!(
                "integer is outside the safe integer range: {u}"
            )));
        }
        return Ok(());
    }
    // Only f64-backed numbers reach here: either non-finite (structurally
    // impossible via serde_json::Number, kept for defense-in-depth) or a
    // number that required float storage, which this profile always
    // treats as non-integer regardless of its mathematical value.
    if let Some(f) = n.as_f64()
        && !f.is_finite()
    {
        return Err(CanonicalJsonError::NonFiniteNumber(
            "number must be finite (NaN/Infinity are not allowed)".to_string(),
        ));
    }
    Err(CanonicalJsonError::NonIntegerNumber(format!(
        "number is not a plain integer: {n}"
    )))
}

/// UTF-16 code unit comparator, matching RFC 8785 §3.2.3 key ordering.
/// Rust strings are UTF-8/scalar-value based, so supplementary-plane
/// characters (e.g. emoji) must be re-encoded to UTF-16 code units before
/// comparing, or ordering would silently disagree with the TypeScript side.
fn utf16_units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn escape_string(value: &str, out: &mut String) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            // Every other scalar value, including the full non-ASCII
            // range, is kept as-is: no NFC normalization. See
            // docs/canonical-json-profile-v1.md.
            c => out.push(c),
        }
    }
    out.push('"');
}

fn serialize(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::String(s) => escape_string(s, out),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else {
                // Unreachable after validate() succeeds.
                out.push_str(&n.to_string());
            }
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                serialize(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by_key(|k| utf16_units(k));
            for (i, key) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                escape_string(key, out);
                out.push(':');
                serialize(map.get(*key).expect("key from map.keys()"), out);
            }
            out.push('}');
        }
    }
}

pub fn canonicalize(value: &Value) -> Result<String, CanonicalJsonError> {
    validate(value)?;
    let mut out = String::new();
    serialize(value, &mut out);
    Ok(out)
}

pub fn canonicalize_bytes(value: &Value) -> Result<Vec<u8>, CanonicalJsonError> {
    Ok(canonicalize(value)?.into_bytes())
}

// ---------------------------------------------------------------------------
// parse_and_canonicalize: a hand-rolled recursive-descent JSON parser.
//
// serde_json's own parser silently collapses duplicate object keys (keeping
// the last one) and has no way to distinguish "1e2" from "100" after the
// fact, so a purpose-built parser is used instead — mirroring the
// TypeScript side exactly.
// ---------------------------------------------------------------------------

struct Parser<'a> {
    chars: Vec<char>,
    pos: usize,
    _source: &'a str,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str) -> Self {
        Parser {
            chars: text.chars().collect(),
            pos: 0,
            _source: text,
        }
    }

    fn fail<T>(&self, message: &str) -> Result<T, CanonicalJsonError> {
        Err(CanonicalJsonError::InvalidJson(format!(
            "{message} at position {}",
            self.pos
        )))
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn skip_whitespace(&mut self) {
        while let Some(c) = self.peek() {
            if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn expect(&mut self, c: char) -> Result<(), CanonicalJsonError> {
        if self.peek() != Some(c) {
            return self.fail(&format!("expected '{c}'"));
        }
        self.pos += 1;
        Ok(())
    }

    fn starts_with(&self, literal: &str) -> bool {
        let lit_chars: Vec<char> = literal.chars().collect();
        if self.pos + lit_chars.len() > self.chars.len() {
            return false;
        }
        self.chars[self.pos..self.pos + lit_chars.len()] == lit_chars[..]
    }

    fn parse(&mut self) -> Result<Value, CanonicalJsonError> {
        self.skip_whitespace();
        let value = self.parse_value()?;
        self.skip_whitespace();
        if self.pos != self.chars.len() {
            return self.fail("unexpected trailing content after top-level value");
        }
        Ok(value)
    }

    fn parse_value(&mut self) -> Result<Value, CanonicalJsonError> {
        let c = match self.peek() {
            Some(c) => c,
            None => return self.fail("unexpected end of input"),
        };
        if c == '{' {
            return self.parse_object();
        }
        if c == '[' {
            return self.parse_array();
        }
        if c == '"' {
            return Ok(Value::String(self.parse_string()?));
        }
        if c == '-' || c.is_ascii_digit() {
            return self.parse_number();
        }
        if self.starts_with("true") {
            self.pos += 4;
            return Ok(Value::Bool(true));
        }
        if self.starts_with("false") {
            self.pos += 5;
            return Ok(Value::Bool(false));
        }
        if self.starts_with("null") {
            self.pos += 4;
            return Ok(Value::Null);
        }
        self.fail(&format!("unexpected character '{c}'"))
    }

    fn parse_object(&mut self) -> Result<Value, CanonicalJsonError> {
        self.expect('{')?;
        let mut map = Map::new();
        self.skip_whitespace();
        if self.peek() == Some('}') {
            self.pos += 1;
            return Ok(Value::Object(map));
        }
        loop {
            self.skip_whitespace();
            if self.peek() != Some('"') {
                return self.fail("expected object key string");
            }
            let key = self.parse_string()?;
            self.skip_whitespace();
            self.expect(':')?;
            self.skip_whitespace();
            let value = self.parse_value()?;
            if map.insert(key.clone(), value).is_some() {
                return Err(CanonicalJsonError::DuplicateJsonKey(format!(
                    "duplicate object key: {key}"
                )));
            }
            self.skip_whitespace();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                    continue;
                }
                Some('}') => {
                    self.pos += 1;
                    return Ok(Value::Object(map));
                }
                _ => return self.fail("expected ',' or '}'"),
            }
        }
    }

    fn parse_array(&mut self) -> Result<Value, CanonicalJsonError> {
        self.expect('[')?;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(']') {
            self.pos += 1;
            return Ok(Value::Array(items));
        }
        loop {
            self.skip_whitespace();
            items.push(self.parse_value()?);
            self.skip_whitespace();
            match self.peek() {
                Some(',') => {
                    self.pos += 1;
                    continue;
                }
                Some(']') => {
                    self.pos += 1;
                    return Ok(Value::Array(items));
                }
                _ => return self.fail("expected ',' or ']'"),
            }
        }
    }

    fn parse_string(&mut self) -> Result<String, CanonicalJsonError> {
        self.expect('"')?;
        let mut out = String::new();
        loop {
            let c = match self.peek() {
                Some(c) => c,
                None => return self.fail("unterminated string"),
            };
            if c == '"' {
                self.pos += 1;
                return Ok(out);
            }
            if c == '\\' {
                self.pos += 1;
                let esc = match self.peek() {
                    Some(c) => c,
                    None => return self.fail("unterminated escape sequence"),
                };
                match esc {
                    '"' => {
                        out.push('"');
                        self.pos += 1;
                    }
                    '\\' => {
                        out.push('\\');
                        self.pos += 1;
                    }
                    '/' => {
                        out.push('/');
                        self.pos += 1;
                    }
                    'b' => {
                        out.push('\u{8}');
                        self.pos += 1;
                    }
                    'f' => {
                        out.push('\u{c}');
                        self.pos += 1;
                    }
                    'n' => {
                        out.push('\n');
                        self.pos += 1;
                    }
                    'r' => {
                        out.push('\r');
                        self.pos += 1;
                    }
                    't' => {
                        out.push('\t');
                        self.pos += 1;
                    }
                    'u' => {
                        let cp = self.parse_hex4()?;
                        if (0xD800..=0xDBFF).contains(&cp) {
                            // High surrogate: must be immediately followed
                            // by a low surrogate escape, or this is an
                            // unpaired surrogate that Rust's UTF-8 `String`
                            // structurally cannot represent.
                            if self.peek() == Some('\\')
                                && self.chars.get(self.pos + 1) == Some(&'u')
                            {
                                self.pos += 1; // skip '\\'; parse_hex4 consumes the 'u'
                                let low = self.parse_hex4()?;
                                if (0xDC00..=0xDFFF).contains(&low) {
                                    let combined = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                                    match char::from_u32(combined) {
                                        Some(ch) => out.push(ch),
                                        None => {
                                            return Err(CanonicalJsonError::InvalidUnicode(
                                                "invalid surrogate pair".to_string(),
                                            ));
                                        }
                                    }
                                } else {
                                    return Err(CanonicalJsonError::InvalidUnicode(
                                        "high surrogate not followed by a low surrogate"
                                            .to_string(),
                                    ));
                                }
                            } else {
                                return Err(CanonicalJsonError::InvalidUnicode(
                                    "unpaired high surrogate".to_string(),
                                ));
                            }
                        } else if (0xDC00..=0xDFFF).contains(&cp) {
                            return Err(CanonicalJsonError::InvalidUnicode(
                                "unpaired low surrogate".to_string(),
                            ));
                        } else {
                            match char::from_u32(cp) {
                                Some(ch) => out.push(ch),
                                None => {
                                    return Err(CanonicalJsonError::InvalidUnicode(
                                        "invalid unicode scalar value".to_string(),
                                    ));
                                }
                            }
                        }
                    }
                    other => return self.fail(&format!("invalid escape character '{other}'")),
                }
                continue;
            }
            if (c as u32) < 0x20 {
                return self.fail("control character in string must be escaped");
            }
            out.push(c);
            self.pos += 1;
        }
    }

    fn parse_hex4(&mut self) -> Result<u32, CanonicalJsonError> {
        if self.peek() != Some('u') {
            return self.fail("expected 'u' in \\u escape");
        }
        self.pos += 1;
        if self.pos + 4 > self.chars.len() {
            return self.fail("invalid \\u escape");
        }
        let hex: String = self.chars[self.pos..self.pos + 4].iter().collect();
        let cp = u32::from_str_radix(&hex, 16).map_err(|_| {
            CanonicalJsonError::InvalidJson(format!("invalid \\u escape at position {}", self.pos))
        })?;
        self.pos += 4;
        Ok(cp)
    }

    fn parse_number(&mut self) -> Result<Value, CanonicalJsonError> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        match self.peek() {
            Some('0') => self.pos += 1,
            Some(c) if c.is_ascii_digit() => {
                while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                    self.pos += 1;
                }
            }
            _ => return self.fail("invalid number literal"),
        }

        let mut is_integer = true;

        if self.peek() == Some('.') {
            is_integer = false;
            self.pos += 1;
            if !matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                return self.fail("invalid number literal: expected digit after decimal point");
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }

        if matches!(self.peek(), Some('e') | Some('E')) {
            is_integer = false;
            self.pos += 1;
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                return self.fail("invalid number literal: expected digit in exponent");
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.pos += 1;
            }
        }

        let text: String = self.chars[start..self.pos].iter().collect();

        if !is_integer {
            // Syntactically valid JSON number, but outside the DDN
            // integer-only profile: any decimal point or exponent marker
            // is rejected regardless of its mathematical value.
            return Err(CanonicalJsonError::NonIntegerNumber(format!(
                "number literal is not a plain integer: {text}"
            )));
        }

        let value: i64 = text.parse().map_err(|_| {
            CanonicalJsonError::UnsafeInteger(format!(
                "integer literal is outside the safe integer range: {text}"
            ))
        })?;
        if !(MIN_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
            return Err(CanonicalJsonError::UnsafeInteger(format!(
                "integer literal is outside the safe integer range: {text}"
            )));
        }
        Ok(Value::Number(Number::from(value)))
    }
}

pub fn parse_and_canonicalize(json_text: &str) -> Result<(Value, String), CanonicalJsonError> {
    let value = Parser::new(json_text).parse()?;
    let mut out = String::new();
    serialize(&value, &mut out);
    Ok((value, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaffold_exports_its_own_package_name() {
        assert_eq!(PACKAGE_NAME, "ddn-canonical-json");
    }

    #[test]
    fn sorts_keys_by_utf16_code_unit() {
        let (_, canonical) = parse_and_canonicalize(r#"{"b":1,"a":2}"#).unwrap();
        assert_eq!(canonical, r#"{"a":2,"b":1}"#);
    }

    #[test]
    fn rejects_duplicate_keys() {
        let err = parse_and_canonicalize(r#"{"a":1,"a":2}"#).unwrap_err();
        assert_eq!(err.code(), "DUPLICATE_JSON_KEY");
    }

    #[test]
    fn rejects_float_literals() {
        let err = parse_and_canonicalize("1.5").unwrap_err();
        assert_eq!(err.code(), "NON_INTEGER_NUMBER");
    }

    #[test]
    fn rejects_unsafe_integers() {
        let err = parse_and_canonicalize("9007199254740992").unwrap_err();
        assert_eq!(err.code(), "UNSAFE_INTEGER");
    }

    #[test]
    fn rejects_lone_surrogates() {
        let err = parse_and_canonicalize(r#""\ud800""#).unwrap_err();
        assert_eq!(err.code(), "INVALID_UNICODE");
    }

    #[test]
    fn round_trips_surrogate_pairs() {
        let (value, canonical) = parse_and_canonicalize(r#""😀""#).unwrap();
        assert_eq!(value, Value::String("\u{1F600}".to_string()));
        assert_eq!(canonical, "\"\u{1F600}\"");
    }
}
