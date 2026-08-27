import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('catalog scripts share one canonical JSON implementation', () => {
  assert.equal(existsSync(join(root, 'scripts/canonical-json.mjs')), true);
});

test('canonical JSON sorts object keys recursively without reordering arrays', async () => {
  const { canonicalJson } = await import('../scripts/canonical-json.mjs');

  assert.equal(
    canonicalJson({ z: [3, { b: true, a: null }], a: 'x' }),
    '{"a":"x","z":[3,{"a":null,"b":true}]}',
  );
});

test('canonical JSON is identical for objects with different insertion order', async () => {
  const { canonicalJson } = await import('../scripts/canonical-json.mjs');

  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test('canonical JSON SHA-256 hashes the canonical UTF-8 bytes', async () => {
  const { canonicalJsonSha256 } = await import('../scripts/canonical-json.mjs');
  const expectedJson = '{"a":1,"b":2}';
  const expectedHash = createHash('sha256').update(expectedJson, 'utf8').digest('hex');

  assert.equal(canonicalJsonSha256({ b: 2, a: 1 }), expectedHash);
  assert.equal(canonicalJsonSha256({ a: 1, b: 2 }), expectedHash);
});
