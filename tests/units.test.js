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
