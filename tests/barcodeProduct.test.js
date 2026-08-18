import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenFoodFactsUrl,
  normalizeRetailBarcode,
  toBarcodeFood,
} from '../src/lib/barcodeProduct.js';

test('selects the first supported retail barcode result', () => {
  assert.equal(normalizeRetailBarcode([
    { text: 'not-retail', format: 'QRCode' },
    { text: '8801234567890', format: 'EAN13' },
    { text: '12345678', format: 'EAN8' },
  ]), '8801234567890');
});

test('accepts every approved retail barcode format and trims scanner text', () => {
  for (const format of ['EAN13', 'EAN8', 'UPCA', 'UPCE']) {
    assert.equal(normalizeRetailBarcode([{ text: ' 012345678905 ', format }]), '012345678905');
  }
});

test('returns null when no supported result has nonempty text', () => {
  assert.equal(normalizeRetailBarcode([]), null);
  assert.equal(normalizeRetailBarcode([{ text: '', format: 'EAN13' }]), null);
  assert.equal(normalizeRetailBarcode([{ text: '8801234567890', format: 'QRCode' }]), null);
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
