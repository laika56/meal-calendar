import assert from 'node:assert/strict';
import test from 'node:test';

import { recognizeBarcodePhoto } from '../public/barcodePhoto.js';

test('uses a high-resolution photo barcode result before loading OCR', async () => {
  let ocrCreated = false;
  const code = await recognizeBarcodePhoto({ name: 'barcode.jpg' }, {
    readBarcodes: async (_file, options) => {
      assert.equal(options.tryHarder, true);
      assert.equal(options.tryDenoise, true);
      return [{ format: 'EAN13', text: '8809036814054' }];
    },
    normalize: () => '8809036814054',
    createRecognizer: async () => { ocrCreated = true; },
    extract: () => null,
  });
  assert.equal(code, '8809036814054');
  assert.equal(ocrCreated, false);
});

test('falls back to digit OCR and always closes its worker', async () => {
  const calls = [];
  const file = { name: 'blurred.jpg' };
  const code = await recognizeBarcodePhoto(file, {
    readBarcodes: async () => [],
    normalize: () => null,
    createRecognizer: async () => ({
      async recognize(image) { calls.push(['recognize', image]); return '8809036814054'; },
      async close() { calls.push(['close']); },
    }),
    extract: (text) => text,
  });
  assert.equal(code, '8809036814054');
  assert.deepEqual(calls, [['recognize', file], ['close']]);
});

test('rejects a missing photo and closes OCR after a recognition failure', async () => {
  await assert.rejects(() => recognizeBarcodePhoto(null, {}), /barcode photo is required/);
  let closed = false;
  await assert.rejects(() => recognizeBarcodePhoto({}, {
    readBarcodes: async () => [],
    normalize: () => null,
    createRecognizer: async () => ({
      async recognize() { throw new Error('ocr failed'); },
      async close() { closed = true; },
    }),
    extract: () => null,
  }), /ocr failed/);
  assert.equal(closed, true);
});
