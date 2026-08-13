import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ImpossibleTargetError,
  buildGoalProfile,
  calcBMR,
  calcTDEE,
  calcTargets,
} from '../src/lib/metabolism.js';

test('calculates all goal, sex, and activity-coefficient combinations', () => {
  const cases = [
    ['male', 0, 'diet', 1780, 2136, { kcal: 1816, proteinG: 160, fatG: 50, carbG: 180 }],
    ['male', 0, 'leanbulk', 1780, 2136, { kcal: 2243, proteinG: 144, fatG: 62, carbG: 277 }],
    ['male', 0, 'bulk', 1780, 2136, { kcal: 2456, proteinG: 128, fatG: 68, carbG: 333 }],
    ['male', 1, 'diet', 1780, 2447.5, { kcal: 2080, proteinG: 160, fatG: 58, carbG: 230 }],
    ['male', 1, 'leanbulk', 1780, 2447.5, { kcal: 2570, proteinG: 144, fatG: 71, carbG: 338 }],
    ['male', 1, 'bulk', 1780, 2447.5, { kcal: 2815, proteinG: 128, fatG: 78, carbG: 400 }],
    ['male', 4, 'diet', 1780, 2759, { kcal: 2345, proteinG: 160, fatG: 65, carbG: 280 }],
    ['male', 4, 'leanbulk', 1780, 2759, { kcal: 2897, proteinG: 144, fatG: 80, carbG: 399 }],
    ['male', 4, 'bulk', 1780, 2759, { kcal: 3173, proteinG: 128, fatG: 88, carbG: 467 }],
    ['male', 6, 'diet', 1780, 3070.5, { kcal: 2610, proteinG: 160, fatG: 72, carbG: 329 }],
    ['male', 6, 'leanbulk', 1780, 3070.5, { kcal: 3224, proteinG: 144, fatG: 90, carbG: 461 }],
    ['male', 6, 'bulk', 1780, 3070.5, { kcal: 3531, proteinG: 128, fatG: 98, carbG: 534 }],
    ['female', 0, 'diet', 1614, 1936.8, { kcal: 1646, proteinG: 160, fatG: 46, carbG: 149 }],
    ['female', 0, 'leanbulk', 1614, 1936.8, { kcal: 2034, proteinG: 144, fatG: 56, carbG: 237 }],
    ['female', 0, 'bulk', 1614, 1936.8, { kcal: 2227, proteinG: 128, fatG: 62, carbG: 290 }],
    ['female', 1, 'diet', 1614, 2219.25, { kcal: 1886, proteinG: 160, fatG: 52, carbG: 194 }],
    ['female', 1, 'leanbulk', 1614, 2219.25, { kcal: 2330, proteinG: 144, fatG: 65, carbG: 293 }],
    ['female', 1, 'bulk', 1614, 2219.25, { kcal: 2552, proteinG: 128, fatG: 71, carbG: 351 }],
    ['female', 4, 'diet', 1614, 2501.7000000000003, { kcal: 2126, proteinG: 160, fatG: 59, carbG: 239 }],
    ['female', 4, 'leanbulk', 1614, 2501.7000000000003, { kcal: 2627, proteinG: 144, fatG: 73, carbG: 349 }],
    ['female', 4, 'bulk', 1614, 2501.7000000000003, { kcal: 2877, proteinG: 128, fatG: 80, carbG: 411 }],
    ['female', 6, 'diet', 1614, 2784.15, { kcal: 2367, proteinG: 160, fatG: 66, carbG: 284 }],
    ['female', 6, 'leanbulk', 1614, 2784.15, { kcal: 2923, proteinG: 144, fatG: 81, carbG: 404 }],
    ['female', 6, 'bulk', 1614, 2784.15, { kcal: 3202, proteinG: 128, fatG: 89, carbG: 472 }],
  ];

  for (const [sex, weeklyWorkouts, goal, bmr, tdee, targets] of cases) {
    assert.equal(calcBMR({ sex, weightKg: 80, heightCm: 180, age: 30 }), bmr);
    assert.equal(calcTDEE(bmr, weeklyWorkouts), tdee);
    assert.deepEqual(calcTargets({ tdee, weightKg: 80, goal }), targets);
  }
});

test('accepts BMR range endpoints and rejects values immediately outside them', () => {
  const valid = { sex: 'male', weightKg: 20, heightCm: 100, age: 10 };
  assert.equal(calcBMR(valid), 780);
  assert.equal(calcBMR({ ...valid, weightKg: 300, heightCm: 250, age: 120 }), 3967.5);

  for (const input of [
    { ...valid, weightKg: 19.9 }, { ...valid, weightKg: 300.1 },
    { ...valid, heightCm: 99.9 }, { ...valid, heightCm: 250.1 },
    { ...valid, age: 9.9 }, { ...valid, age: 120.1 },
  ]) assert.throws(() => calcBMR(input), RangeError);
});

test('rejects invalid BMR sex and numeric inputs by type', () => {
  const valid = { sex: 'male', weightKg: 80, heightCm: 180, age: 30 };
  assert.throws(() => calcBMR({ ...valid, sex: 'other' }), TypeError);
  for (const key of ['weightKg', 'heightCm', 'age']) {
    assert.throws(() => calcBMR({ ...valid, [key]: '80' }), TypeError);
    assert.throws(() => calcBMR({ ...valid, [key]: NaN }), TypeError);
  }
});

test('uses each workout boundary coefficient and rejects invalid workout counts', () => {
  const expected = [[0, 120], [1, 137.5], [3, 137.5], [4, 155], [5, 155], [6, 172.5], [7, 172.5]];
  for (const [weeklyWorkouts, tdee] of expected) assert.equal(calcTDEE(100, weeklyWorkouts), tdee);
  for (const weeklyWorkouts of [-1, 0.5, 7.5, 8]) {
    assert.throws(() => calcTDEE(100, weeklyWorkouts), RangeError);
  }
});

test('keeps zero calculated carbs as a valid target', () => {
  assert.deepEqual(calcTargets({ tdee: 800 / 0.85, weightKg: 75, goal: 'diet' }), {
    kcal: 800, proteinG: 150, fatG: 22, carbG: 0,
  });
});

test('throws ImpossibleTargetError with the negative carbs and kcal in its message', () => {
  assert.throws(
    () => calcTargets({ tdee: 300, weightKg: 244.21875, goal: 'diet' }),
    (error) => error instanceof ImpossibleTargetError
      && error.message.includes('-440.625')
      && error.message.includes('255'),
  );
});

test('calculates protein before assigning carbohydrates as the remainder', () => {
  assert.equal(calcTargets({ tdee: 2000, weightKg: 80, goal: 'leanbulk' }).proteinG, 144);
});

test('buildGoalProfile passes an unrounded TDEE into target calculation', () => {
  const input = { sex: 'male', weightKg: 20, heightCm: 100, age: 16, weeklyWorkouts: 1, goal: 'diet' };
  const bmr = 750;
  const unroundedTdee = 1031.25;
  const targetsFromUnroundedTdee = { kcal: 877, proteinG: 40, fatG: 24, carbG: 124 };
  const targetsFromRoundedTdee = { kcal: 876, proteinG: 40, fatG: 24, carbG: 124 };

  assert.deepEqual(calcTargets({ tdee: unroundedTdee, weightKg: 20, goal: 'diet' }), targetsFromUnroundedTdee);
  assert.deepEqual(calcTargets({ tdee: Math.round(unroundedTdee), weightKg: 20, goal: 'diet' }), targetsFromRoundedTdee);
  assert.deepEqual(buildGoalProfile(input), { bmr: 750, tdee: 1031, ...targetsFromUnroundedTdee });
});

test('buildGoalProfile propagates lower-level errors', () => {
  assert.throws(
    () => buildGoalProfile({ sex: 'male', weightKg: 19.9, heightCm: 180, age: 30, weeklyWorkouts: 0, goal: 'diet' }),
    RangeError,
  );
  assert.throws(
    () => buildGoalProfile({ sex: 'male', weightKg: 80, heightCm: 180, age: 30, weeklyWorkouts: 8, goal: 'diet' }),
    RangeError,
  );
  assert.throws(
    () => buildGoalProfile({ sex: 'other', weightKg: 80, heightCm: 180, age: 30, weeklyWorkouts: 0, goal: 'diet' }),
    TypeError,
  );
  assert.throws(
    () => buildGoalProfile({ sex: 'female', weightKg: 300, heightCm: 100, age: 120, weeklyWorkouts: 0, goal: 'diet' }),
    ImpossibleTargetError,
  );
});
