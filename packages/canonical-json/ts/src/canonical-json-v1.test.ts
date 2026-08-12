// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAndCanonicalize, CanonicalJsonError } from './index.js';

// Shared with the Rust side via packages/test-vectors/vectors/canonical-json-v1.json.
// See packages/canonical-json/rust/tests/cross_language_vectors.rs.
const vectorsPath = fileURLToPath(
  new URL('../../../test-vectors/vectors/canonical-json-v1.json', import.meta.url)
);

interface ValidVector {
  id: string;
  inputJson: string;
  canonicalJson: string;
  sha256: string;
}

interface InvalidVector {
  id: string;
  inputJson: string;
  errorCode: string;
}

interface VectorsDoc {
  vectorVersion: string;
  valid: ValidVector[];
  invalid: InvalidVector[];
}

function sha256Hex(text: string): string {
  return 'sha256:' + createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

const doc: VectorsDoc = JSON.parse(readFileSync(vectorsPath, 'utf8'));

test('canonical-json-v1 vectors: at least 30 valid vectors are present', () => {
  assert.ok(doc.valid.length >= 30, `expected at least 30 valid vectors, got ${doc.valid.length}`);
});

for (const vector of doc.valid) {
  test(`canonical-json-v1 valid vector: ${vector.id}`, () => {
    const { canonical } = parseAndCanonicalize(vector.inputJson);
    assert.equal(canonical, vector.canonicalJson, `vector ${vector.id}: canonical string mismatch`);
    assert.equal(sha256Hex(canonical), vector.sha256, `vector ${vector.id}: sha256 mismatch`);
  });
}

for (const vector of doc.invalid) {
  test(`canonical-json-v1 invalid vector: ${vector.id}`, () => {
    assert.throws(
      () => parseAndCanonicalize(vector.inputJson),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalJsonError, `vector ${vector.id}: expected CanonicalJsonError`);
        assert.equal(err.code, vector.errorCode, `vector ${vector.id}: error code mismatch`);
        return true;
      }
    );
  });
}
