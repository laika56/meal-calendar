import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkCalorieConsistency,
  kjToKcal,
  scaleNutrients,
} from '../src/lib/units.js';

test('scales synthetic per-100g nutrients and rounds each value to one decimal place', () => {
  assert.deepEqual(
    scaleNutrients({ kcal: 200, carbG: 30.04, proteinG: 10, fatG: 8 }, 37.5),
    { kcal: 75, carbG: 11.3, proteinG: 3.8, fatG: 3 },
  );
});

test('keeps null nutrients null and treats missing nutrient keys as null', () => {
  assert.deepEqual(
    scaleNutrients({ kcal: 200, carbG: null }, 50),
    { kcal: 100, carbG: null, proteinG: null, fatG: null },
  );
});

test('returns zero for known nutrients at zero grams without replacing null', () => {
  assert.deepEqual(
    scaleNutrients({ kcal: 200, carbG: 30, proteinG: 10, fatG: null }, 0),
    { kcal: 0, carbG: 0, proteinG: 0, fatG: null },
  );
});

test('rejects negative and NaN serving amounts', () => {
  const nutrients = { kcal: 200, carbG: 30, proteinG: 10, fatG: 8 };
  assert.throws(() => scaleNutrients(nutrients, -0.1), RangeError);
  assert.throws(() => scaleNutrients(nutrients, NaN), RangeError);
});

test('reports exact serving amount errors before validating nutrient values', () => {
  const nutrients = { kcal: undefined, carbG: null, proteinG: 10, fatG: 5 };
  const cases = [
    [undefined, 'scaleNutrients: amountG must be a number, got undefined'],
    [NaN, 'scaleNutrients: amountG must be a number, got NaN'],
    [-0.1, 'scaleNutrients: amountG must not be negative, got -0.1'],
  ];

  for (const [amountG, message] of cases) {
    assert.throws(() => scaleNutrients(nutrients, amountG), { name: 'RangeError', message });
  }
});

test('rejects invalid present nutrient values in nutrient-key order', () => {
  assert.throws(
    () => scaleNutrients({ kcal: undefined, carbG: null, proteinG: 10, fatG: 5 }, 100),
    {
      name: 'TypeError',
      message: 'scaleNutrients: per100g.kcal must be a number or null, got undefined',
    },
  );
  assert.throws(
    () => scaleNutrients({ kcal: 200, carbG: NaN, proteinG: '10', fatG: 5 }, 100),
    {
      name: 'TypeError',
      message: 'scaleNutrients: per100g.carbG must be a number or null, got NaN',
    },
  );
});

test('converts synthetic kilojoule values to one-decimal kilocalories', () => {
  assert.equal(kjToKcal(418.4), 100);
  assert.equal(kjToKcal(50), 12);
});

test('converts the zero-kilojoule boundary to zero kilocalories', () => {
  assert.equal(kjToKcal(0), 0);
});

test('keeps null kilojoules null and rejects negative or NaN values', () => {
  assert.equal(kjToKcal(null), null);
  assert.throws(() => kjToKcal(-0.1), RangeError);
  assert.throws(() => kjToKcal(NaN), RangeError);
});

test('rejects invalid kilojoule values with exact messages instead of returning NaN', () => {
  assert.throws(
    () => kjToKcal(undefined),
    { name: 'TypeError', message: 'kjToKcal: kj must be a number or null, got undefined' },
  );
  assert.throws(
    () => kjToKcal(NaN),
    { name: 'RangeError', message: 'kjToKcal: kj must be a number, got NaN' },
  );
  assert.throws(
    () => kjToKcal(-0.1),
    { name: 'RangeError', message: 'kjToKcal: kj must not be negative, got -0.1' },
  );
});

test('reports a rounded calculated calorie value and deviation', () => {
  assert.deepEqual(
    checkCalorieConsistency({ kcal: 100, carbG: 10.01, proteinG: 5.02, fatG: 4.03 }),
    { ok: true, calculatedKcal: 96.4, deviation: 0.036 },
  );
});

test('accepts deviation at the inclusive 0.20 boundary and rejects larger deviation', () => {
  assert.deepEqual(
    checkCalorieConsistency({ kcal: 100, carbG: 30, proteinG: 0, fatG: 0 }),
    { ok: true, calculatedKcal: 120, deviation: 0.2 },
  );
  assert.deepEqual(
    checkCalorieConsistency({ kcal: 100, carbG: 30.1, proteinG: 0, fatG: 0 }),
    { ok: false, calculatedKcal: 120.4, deviation: 0.204 },
  );
});

test('returns an indeterminate result without throwing for zero kcal or any null field', () => {
  const indeterminate = { ok: null, calculatedKcal: null, deviation: null };
  const cases = [
    { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 },
    { kcal: null, carbG: 10, proteinG: 5, fatG: 4 },
    { kcal: 100, carbG: null, proteinG: 5, fatG: 4 },
    { kcal: 100, carbG: 10, proteinG: null, fatG: 4 },
    { kcal: 100, carbG: 10, proteinG: 5, fatG: null },
  ];

  for (const input of cases) {
    assert.doesNotThrow(() => checkCalorieConsistency(input));
    assert.deepEqual(checkCalorieConsistency(input), indeterminate);
  }
});
