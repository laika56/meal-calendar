import assert from 'node:assert/strict';
import test from 'node:test';

import { createBarcodeRecognizer } from '../public/barcodeOcr.js';

test('configures an English digit-only worker and reuses it until close', async () => {
  const calls = [];
  const worker = {
    async setParameters(parameters) { calls.push(['setParameters', parameters]); },
    async recognize(image) {
      calls.push(['recognize', image]);
      return { data: { text: '8809036814054\n' } };
    },
    async terminate() { calls.push(['terminate']); },
  };
  const recognizer = await createBarcodeRecognizer({
    pageSegMode: '11',
    loadTesseract: async () => ({
      async createWorker(language) {
        calls.push(['createWorker', language]);
        return worker;
      },
    }),
  });

  assert.equal(await recognizer.recognize('frame-1'), '8809036814054\n');
  assert.equal(await recognizer.recognize('frame-2'), '8809036814054\n');
  await recognizer.close();
  await recognizer.close();
  assert.deepEqual(calls, [
    ['createWorker', 'eng'],
    ['setParameters', {
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: '11',
    }],
    ['recognize', 'frame-1'],
    ['recognize', 'frame-2'],
    ['terminate'],
  ]);
});

test('keeps full-photo OCR in block mode unless a digit strip requests one line', async () => {
  let parameters;
  const recognizer = await createBarcodeRecognizer({
    loadTesseract: async () => ({
      createWorker: async () => ({
        async setParameters(value) { parameters = value; },
        async recognize() { return { data: { text: '' } }; },
        async terminate() {},
      }),
    }),
  });
  assert.equal(parameters.tessedit_pageseg_mode, '6');
  await recognizer.close();
});

test('rejects missing images, malformed OCR results, and use after close', async () => {
  const recognizer = await createBarcodeRecognizer({
    loadTesseract: async () => ({
      createWorker: async () => ({
        setParameters: async () => {},
        recognize: async () => ({ data: {} }),
        terminate: async () => {},
      }),
    }),
  });

  await assert.rejects(() => recognizer.recognize(null), /barcode image is required/);
  await assert.rejects(() => recognizer.recognize({}), /OCR result text is unavailable/);
  await recognizer.close();
  await assert.rejects(() => recognizer.recognize({}), /barcode recognizer is closed/);
});
