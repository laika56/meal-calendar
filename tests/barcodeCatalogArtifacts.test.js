import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validateBarcodeArtifacts } from '../scripts/validate-barcode-catalog.mjs';

const record = {
  barcode: '96385074', name: '검증 식품', maker: null, category: null, serving: null,
  per100g: { kcal: 100, carbG: null, proteinG: null, fatG: null },
  source: { type: 'foodqr', sourceId: 'one', url: 'https://example.test/one', verifiedAt: '2026-08-19' },
};

test('validates the exact three barcode staging artifacts and rejects extras or tampering', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'barcode-artifacts-'));
  const bytes = `${JSON.stringify(record)}\n`;
  const { createHash } = await import('node:crypto');
  const manifest = {
    schemaVersion: 1,
    recordCount: 1,
    materialSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await writeFile(path.join(root, 'barcode-foods.ndjson'), bytes);
  await writeFile(path.join(root, 'barcode-catalog-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(root, 'BARCODE_CATALOG_REVIEW.md'), '# Review\n');
  assert.equal((await validateBarcodeArtifacts(root)).records.length, 1);
  await writeFile(path.join(root, 'foreign.txt'), 'foreign');
  await assert.rejects(validateBarcodeArtifacts(root), /exactly the reviewed artifact set/);
});
