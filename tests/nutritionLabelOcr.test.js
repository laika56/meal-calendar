import assert from 'node:assert/strict';
import test from 'node:test';

import { recognizeNutritionLabel } from '../public/nutritionLabelOcr.js';

test('lazy-loads one worker, returns text, and always terminates it', async () => {
  const calls = [];
  const worker = {
    recognize: async (file) => { calls.push(['recognize', file]); return { data: { text: '열량 100 kcal' } }; },
    terminate: async () => { calls.push(['terminate']); },
  };
  const file = { name: 'label.jpg' };
  const text = await recognizeNutritionLabel(file, {
    loadTesseract: async () => ({
      createWorker: async (...args) => { calls.push(['createWorker', ...args]); return worker; },
    }),
  });
  assert.equal(text, '열량 100 kcal');
  assert.deepEqual(calls.map((call) => call[0]), ['createWorker', 'recognize', 'terminate']);
});

test('terminates the worker when recognition fails', async () => {
  let terminated = false;
  await assert.rejects(() => recognizeNutritionLabel({}, {
    loadTesseract: async () => ({ createWorker: async () => ({
      recognize: async () => { throw new Error('ocr failed'); },
      terminate: async () => { terminated = true; },
    }) }),
  }), /ocr failed/);
  assert.equal(terminated, true);
});
