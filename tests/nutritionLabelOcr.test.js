import assert from 'node:assert/strict';
import test from 'node:test';

import { createNutritionLabelRecognizer, recognizeNutritionLabel } from '../public/nutritionLabelOcr.js';

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

test('reuses one worker across automatic camera attempts and closes it once', async () => {
  const recognized = [];
  let terminated = 0;
  const recognizer = await createNutritionLabelRecognizer({
    loadTesseract: async () => ({ createWorker: async () => ({
      recognize: async (image) => { recognized.push(image); return { data: { text: String(image) } }; },
      terminate: async () => { terminated += 1; },
    }) }),
  });
  assert.equal(await recognizer.recognize('frame-1'), 'frame-1');
  assert.equal(await recognizer.recognize('frame-2'), 'frame-2');
  await recognizer.close();
  assert.deepEqual(recognized, ['frame-1', 'frame-2']);
  assert.equal(terminated, 1);
});
