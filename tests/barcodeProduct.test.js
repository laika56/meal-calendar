import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenFoodFactsUrl,
  normalizeRetailBarcode,
  toBarcodeFood,
} from '../src/lib/barcodeProduct.js';

test('returns a valid EAN-13 unchanged and trims scanner text', () => {
  assert.equal(
    normalizeRetailBarcode([{ format: 'EAN13', text: '  9780143007234  ' }]),
    '9780143007234',
  );
});

test('normalizes a valid UPC-A to EAN-13', () => {
  assert.equal(
    normalizeRetailBarcode([{ format: 'UPCA', text: '036000291452' }]),
    '0036000291452',
  );
});

test('skips EAN-8 because it cannot be normalized to EAN-13', () => {
  assert.equal(normalizeRetailBarcode([{ format: 'EAN8', text: '96385074' }]), null);
});

test('expands a valid UPC-E and normalizes it to EAN-13', () => {
  assert.equal(
    normalizeRetailBarcode([{ format: 'UPCE', text: '04252614' }]),
    '0042100005264',
  );
});

test('rejects invalid UPC-E and invalid EAN-13 check digits', () => {
  assert.equal(normalizeRetailBarcode([{ format: 'UPCE', text: '01278906' }]), null);
  assert.equal(normalizeRetailBarcode([{ format: 'EAN13', text: '9780143007235' }]), null);
});

test('uses the first usable barcode whether invalid input comes before or after it', () => {
  const invalid = { format: 'EAN13', text: '9780143007235' };
  const valid = { format: 'EAN13', text: '9780143007234' };

  assert.equal(normalizeRetailBarcode([invalid, valid]), '9780143007234');
  assert.equal(normalizeRetailBarcode([valid, invalid]), '9780143007234');
});

test('skips non-retail results and continues to a usable retail barcode', () => {
  assert.equal(normalizeRetailBarcode([
    { format: 'QR_CODE', text: '9780143007234' },
    { format: 'UPCA', text: '036000291452' },
  ]), '0036000291452');
  assert.equal(
    normalizeRetailBarcode([{ format: 'QR_CODE', text: '9780143007234' }]),
    null,
  );
});

test('skips nullish results and unusable text without throwing', () => {
  assert.equal(normalizeRetailBarcode([
    null,
    undefined,
    { format: 'EAN13', text: null },
    { format: 'EAN13', text: '   ' },
    { format: 'EAN13', text: '9780143007234' },
  ]), '9780143007234');
});

test('returns null when no result is usable', () => {
  assert.equal(normalizeRetailBarcode([]), null);
  assert.equal(normalizeRetailBarcode([{ text: '', format: 'EAN13' }]), null);
});

test('rejects a scanner payload that is not an array', () => {
  assert.throws(
    () => normalizeRetailBarcode(null),
    { name: 'TypeError', message: 'normalizeRetailBarcode: results must be an array' },
  );
});

test('builds the pinned Open Food Facts v2 product URL with an encoded barcode', () => {
  assert.equal(
    buildOpenFoodFactsUrl(' 880 123 '),
    'https://world.openfoodfacts.org/api/v2/product/880%20123.json',
  );
});

test('rejects an empty Open Food Facts barcode', () => {
  assert.throws(
    () => buildOpenFoodFactsUrl('  '),
    { name: 'TypeError', message: 'buildOpenFoodFactsUrl: barcode must be a nonempty string' },
  );
});

test('maps a complete parsed OFF product to the existing food shape', () => {
  const parsed = {
    code: '8801234567890',
    name: '테스트바',
    brand: '테스트식품',
    unit: 'g',
    per100: { kcal: 210, proteinG: 12, fatG: 7, carbG: 24 },
  };

  assert.deepEqual(toBarcodeFood(parsed), {
    foodKey: 'off_8801234567890',
    name: '테스트바',
    maker: '테스트식품',
    source: 'off',
    barcode: '8801234567890',
    per100g: { kcal: 210, proteinG: 12, fatG: 7, carbG: 24 },
    basis: 'g',
    serving: null,
  });
});

test('returns null unless name, supported basis, and all four nutrients are present', () => {
  const complete = {
    code: '8801234567890',
    name: '테스트바',
    brand: null,
    unit: 'g',
    per100: { kcal: 210, proteinG: 12, fatG: 7, carbG: 24 },
  };

  assert.equal(toBarcodeFood(null), null);
  assert.equal(toBarcodeFood({ ...complete, name: null }), null);
  assert.equal(toBarcodeFood({ ...complete, unit: null, per100: null }), null);
  assert.equal(toBarcodeFood({ ...complete, unit: 'oz' }), null);
  assert.equal(toBarcodeFood({ ...complete, per100: { ...complete.per100, fatG: null } }), null);
});
