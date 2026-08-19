import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNutritionLabel } from '../src/lib/nutritionLabel.js';

test('parses one adjacent Korean value for each supported nutrition heading', () => {
  assert.deepEqual(
    parseNutritionLabel('총 내용량 100 g\n열량 220 kcal\n탄수화물 31 g\n단백질 8 g\n지방 7 g'),
    { amount: 100, amountUnit: 'g', kcal: 220, carbG: 31, proteinG: 8, fatG: 7 },
  );
});

test('accepts one serving and English labels without inventing missing nutrients', () => {
  assert.deepEqual(
    parseNutritionLabel('Serving size 250 mL\nCalories 130\nProtein 6 g'),
    { amount: 250, amountUnit: 'mL', kcal: 130, carbG: null, proteinG: 6, fatG: null },
  );
});

test('leaves a field null when its unit is missing or competing values follow the same heading', () => {
  assert.deepEqual(
    parseNutritionLabel('총 내용량 100\n열량 100 kcal 200 kcal\n탄수화물 0 g'),
    { amount: null, amountUnit: null, kcal: null, carbG: 0, proteinG: null, fatG: null },
  );
});

test('rejects non-string OCR input', () => {
  assert.throws(() => parseNutritionLabel(null), /OCR text must be a string/);
});
