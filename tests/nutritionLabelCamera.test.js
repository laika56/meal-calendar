import assert from 'node:assert/strict';
import test from 'node:test';

import { assessLabelFrame, labelFrameSignature } from '../src/lib/nutritionLabelCamera.js';

const rgba = (values) => new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));

test('accepts a sharp frame only after it stays visually stable', () => {
  const first = labelFrameSignature(rgba([0, 255, 0, 255]), 2, 2);
  const same = labelFrameSignature(rgba([1, 254, 1, 254]), 2, 2);
  assert.deepEqual(assessLabelFrame(null, first), { sharp: true, stable: false });
  assert.deepEqual(assessLabelFrame(first, same), { sharp: true, stable: true });
});

test('rejects blurred or moving frames before OCR', () => {
  const blurred = labelFrameSignature(rgba([120, 121, 120, 121]), 2, 2);
  const sharp = labelFrameSignature(rgba([0, 255, 0, 255]), 2, 2);
  const moved = labelFrameSignature(rgba([255, 0, 255, 0]), 2, 2);
  assert.deepEqual(assessLabelFrame(null, blurred), { sharp: false, stable: false });
  assert.equal(assessLabelFrame(sharp, moved).stable, false);
});
