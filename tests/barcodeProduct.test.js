import assert from 'node:assert/strict';
import test from 'node:test';

import {
  barcodeCapturePlan,
  configureBarcodeTrack,
  barcodeVideoConstraints,
  buildOpenFoodFactsUrl,
  extractRetailBarcodeFromOcr,
  normalizeRetailBarcode,
  sharedCatalogRecordToFood,
  toBarcodeFood,
} from '../src/lib/barcodeProduct.js';

test('crops a landscape camera frame to the centered 5:2 barcode reticle before decoding', () => {
  assert.deepEqual(barcodeCapturePlan(1920, 1080), {
    sourceX: 230,
    sourceY: 248,
    sourceWidth: 1459,
    sourceHeight: 584,
    outputWidth: 1280,
    outputHeight: 512,
  });
});

test('keeps the centered barcode crop inside portrait video and rejects missing dimensions', () => {
  assert.deepEqual(barcodeCapturePlan(1080, 1920), {
    sourceX: 130,
    sourceY: 796,
    sourceWidth: 820,
    sourceHeight: 328,
    outputWidth: 820,
    outputHeight: 328,
  });
  assert.deepEqual(barcodeCapturePlan(1, 1), {
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 1,
    sourceHeight: 1,
    outputWidth: 1,
    outputHeight: 1,
  });
  assert.equal(barcodeCapturePlan(0, 1080), null);
  assert.equal(barcodeCapturePlan(1920, Number.NaN), null);
});

test('asks the rear camera for enough detail to decode retail bars', () => {
  assert.deepEqual(barcodeVideoConstraints(), {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  });
});

test('enables continuous focus and a bounded 2x zoom when the camera exposes them', async () => {
  const applied = [];
  const track = {
    getCapabilities() {
      return {
        focusMode: ['manual', 'continuous'],
        zoom: { min: 1, max: 8, step: 0.1 },
      };
    },
    async applyConstraints(constraints) {
      applied.push(constraints);
    },
  };

  assert.equal(await configureBarcodeTrack(track), true);
  assert.deepEqual(applied, [{
    advanced: [{ focusMode: 'continuous', zoom: 2 }],
  }]);
});

test('uses only supported focus controls and treats camera constraint rejection as optional', async () => {
  const focusOnly = [];
  assert.equal(await configureBarcodeTrack({
    getCapabilities: () => ({ focusMode: ['single-shot', 'continuous'] }),
    async applyConstraints(constraints) { focusOnly.push(constraints); },
  }), true);
  assert.deepEqual(focusOnly, [{ advanced: [{ focusMode: 'continuous' }] }]);

  assert.equal(await configureBarcodeTrack({
    getCapabilities: () => ({ zoom: { min: 1, max: 1, step: 0 } }),
    async applyConstraints() { throw new Error('must not run'); },
  }), false);
  assert.equal(await configureBarcodeTrack({
    getCapabilities: () => ({ focusMode: ['continuous'] }),
    async applyConstraints() { throw new Error('unsupported on this iPhone'); },
  }), false);
  assert.equal(await configureBarcodeTrack({}), false);
});

test('falls back to continuous focus when a camera rejects the combined zoom request', async () => {
  const applied = [];
  const track = {
    getCapabilities: () => ({
      focusMode: ['continuous'],
      zoom: { min: 1, max: 4, step: 0.1 },
    }),
    async applyConstraints(constraints) {
      applied.push(constraints);
      if (applied.length === 1) throw new Error('zoom rejected');
    },
  };

  assert.equal(await configureBarcodeTrack(track), true);
  assert.deepEqual(applied, [
    { advanced: [{ focusMode: 'continuous', zoom: 2 }] },
    { advanced: [{ focusMode: 'continuous' }] },
  ]);
});

test('extracts one check-digit-valid retail code from noisy OCR lines', () => {
  assert.equal(extractRetailBarcodeFromOcr([
    '2026년 09월 07일 23시 F2',
    '||| |||| |||',
    '8809 0368 14054',
  ].join('\n')), '8809036814054');
  assert.equal(extractRetailBarcodeFromOcr('UPC 036000291452'), '0036000291452');
  assert.equal(extractRetailBarcodeFromOcr('9638-5074'), '96385074');
});

test('rejects invalid, absent, or ambiguous OCR barcode candidates', () => {
  assert.equal(extractRetailBarcodeFromOcr('8809036814053'), null);
  assert.equal(extractRetailBarcodeFromOcr('2026-09-07 23:00'), null);
  assert.equal(extractRetailBarcodeFromOcr('96385074\n8809036814054'), null);
  assert.throws(() => extractRetailBarcodeFromOcr(null), /OCR text must be a string/);
});

test('returns a valid EAN-13 unchanged and trims scanner text', () => {
  assert.equal(
    normalizeRetailBarcode([{ format: 'EAN13', text: '  9780143007234  ' }]),
    '9780143007234',
  );
});

test('maps a shared catalog record without erasing partial nutrients or provenance', () => {
  assert.deepEqual(sharedCatalogRecordToFood({
    barcode: '0036000291452',
    name: '검증 제품',
    maker: '검증 제조사',
    category: '가공식품',
    serving: { amount: 80, unit: 'g', source: 'official-serving' },
    per100g: { kcal: 210, proteinG: 12, fatG: null, carbG: null },
    source: {
      type: 'foodqr', sourceId: 'source-1', url: 'https://example.test/1', verifiedAt: '2026-08-19',
    },
  }), {
    foodKey: 'barcode_0036000291452',
    name: '검증 제품',
    maker: '검증 제조사',
    category: '가공식품',
    source: 'barcode-catalog',
    barcode: '0036000291452',
    per100g: { kcal: 210, proteinG: 12, fatG: null, carbG: null },
    basis: 'g',
    serving: { amount: 80, unit: 'g', source: 'official-serving' },
    nutritionProvenance: {
      kcal: 'foodqr', proteinG: 'foodqr', fatG: null, carbG: null,
    },
  });
  assert.equal(sharedCatalogRecordToFood({ name: '불완전' }), null);
});

test('normalizes a valid UPC-A to EAN-13', () => {
  assert.equal(
    normalizeRetailBarcode([{ format: 'UPCA', text: '036000291452' }]),
    '0036000291452',
  );
});

test('passes a valid EAN-8 through unchanged instead of dropping it', () => {
  // EAN-8 은 EAN-13 으로 확장할 수 없지만 Open Food Facts 는 8자리 코드 그대로 저장한다.
  // 발주30 이 toEan13 만 통과시켜서 EAN-8 제품이 조회조차 안 되는 회귀가 났었다.
  assert.equal(normalizeRetailBarcode([{ format: 'EAN8', text: '96385074' }]), '96385074');
});

test('still rejects an EAN-8 whose check digit is wrong', () => {
  assert.equal(normalizeRetailBarcode([{ format: 'EAN8', text: '96385075' }]), null);
});

test('skips a broken EAN-8 but still finds a good code later in the batch', () => {
  assert.equal(
    normalizeRetailBarcode([
      { format: 'EAN8', text: '96385075' },
      { format: 'EAN13', text: '9780143007234' },
    ]),
    '9780143007234',
  );
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

test('preserves missing macros as null when verified kcal and identity are present', () => {
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
  assert.deepEqual(toBarcodeFood({
    ...complete,
    per100: { ...complete.per100, fatG: null, carbG: null },
  }).per100g, { kcal: 210, proteinG: 12, fatG: null, carbG: null });
  assert.equal(toBarcodeFood({ ...complete, per100: { ...complete.per100, kcal: null } }), null);
});
