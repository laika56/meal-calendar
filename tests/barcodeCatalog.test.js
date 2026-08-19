import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalCatalogBarcode,
  chooseBarcodeCandidate,
  normalizeBarcodeCatalogRecord,
  validateBarcodeCatalog,
} from '../src/lib/barcodeCatalog.js';

const baseRecord = {
  barcode: '9780143007234',
  name: '검증 제품',
  maker: '검증 제조사',
  category: null,
  serving: { amount: 80, unit: 'g', source: 'official-serving' },
  per100g: { kcal: 100, carbG: 10, proteinG: 5, fatG: 4 },
  source: {
    type: 'foodqr',
    sourceId: 'fixture-1',
    url: 'https://example.test/products/fixture-1',
    verifiedAt: '2026-08-19',
  },
};

test('canonicalizes validated retail GTIN forms without losing significant digits', () => {
  assert.equal(canonicalCatalogBarcode('96385074'), '96385074');
  assert.equal(canonicalCatalogBarcode('036000291452'), '0036000291452');
  assert.equal(canonicalCatalogBarcode('9780143007234'), '9780143007234');
  assert.equal(canonicalCatalogBarcode('09780143007234'), '9780143007234');
  assert.equal(canonicalCatalogBarcode('12345678901231'), '12345678901231');
});

test('rejects malformed, lossy, or unsupported catalog barcode inputs', () => {
  for (const value of [
    9780143007234,
    ' 9780143007234 ',
    '978-0143007234',
    '9780143007235',
    '1234567',
    '12345678901',
    '123456789012345',
    '',
    null,
  ]) {
    assert.equal(canonicalCatalogBarcode(value), null, String(value));
  }
});

test('normalizes a closed catalog record while preserving missing nutrients as null', () => {
  const input = {
    ...baseRecord,
    barcode: '036000291452',
    name: '  검증 제품  ',
    maker: '  검증 제조사  ',
    per100g: { kcal: 100, carbG: null, proteinG: 5, fatG: null },
  };
  const output = normalizeBarcodeCatalogRecord(input);

  assert.deepEqual(output, {
    ...input,
    barcode: '0036000291452',
    name: '검증 제품',
    maker: '검증 제조사',
  });
  assert.notEqual(output, input);
  assert.notEqual(output.per100g, input.per100g);
});

test('rejects unknown fields and invalid nutrient or serving values', () => {
  assert.throws(
    () => normalizeBarcodeCatalogRecord({ ...baseRecord, raw: 'must not leak' }),
    /catalog record has unexpected key raw/,
  );
  assert.throws(
    () => normalizeBarcodeCatalogRecord({
      ...baseRecord,
      per100g: { ...baseRecord.per100g, kcal: -1 },
    }),
    /per100g\.kcal must be null or a finite non-negative number/,
  );
  assert.throws(
    () => normalizeBarcodeCatalogRecord({
      ...baseRecord,
      serving: { ...baseRecord.serving, amount: 0 },
    }),
    /serving\.amount must be a finite positive number/,
  );
});

test('chooses one complete candidate by source priority without mixing nutrient fields', () => {
  const off = {
    ...baseRecord,
    per100g: { kcal: 110, carbG: 11, proteinG: 6, fatG: 5 },
    source: { ...baseRecord.source, type: 'off', sourceId: 'off-1' },
  };
  const mfds = {
    ...baseRecord,
    per100g: { kcal: 100, carbG: null, proteinG: null, fatG: null },
    source: { ...baseRecord.source, type: 'mfds', sourceId: 'mfds-1' },
  };

  const chosen = chooseBarcodeCandidate([off, mfds]);
  assert.equal(chosen.source.type, 'mfds');
  assert.deepEqual(chosen.per100g, { kcal: 100, carbG: null, proteinG: null, fatG: null });
});

test('refuses conflicting candidates at the same source priority', () => {
  const second = {
    ...baseRecord,
    name: '다른 제품',
    source: { ...baseRecord.source, sourceId: 'fixture-2' },
  };
  assert.throws(
    () => chooseBarcodeCandidate([baseRecord, second]),
    /conflicting foodqr candidates for 9780143007234/,
  );
});

test('validates canonical order, unique barcodes, counts, and material hash', () => {
  const first = normalizeBarcodeCatalogRecord({ ...baseRecord, barcode: '96385074' });
  const second = normalizeBarcodeCatalogRecord(baseRecord);
  const records = [first, second];
  const manifest = {
    schemaVersion: 1,
    recordCount: 2,
    materialSha256: '75733c5e3a375a17a354ba78d56ebef81f0ac36036f400559c66195e4e2c951a',
  };

  assert.deepEqual(validateBarcodeCatalog(records, manifest), { records, manifest });
  assert.throws(
    () => validateBarcodeCatalog([second, first], manifest),
    /records must be sorted by barcode/,
  );
  assert.throws(
    () => validateBarcodeCatalog([first, first], manifest),
    /duplicate barcode 96385074/,
  );
});
