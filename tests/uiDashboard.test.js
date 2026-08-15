import assert from 'node:assert/strict';
import test from 'node:test';

import {
  monthDashboardSummary,
  progressPercent,
  servingChoiceOptions,
} from '../src/lib/uiDashboard.js';

test('monthDashboardSummary counts recorded and on-target days and averages recorded kcal', () => {
  assert.deepEqual(monthDashboardSummary([
    { date: '2026-08-01', totals: { kcal: 1800 }, weightKg: 70.2 },
    { date: '2026-08-02', totals: { kcal: 2000 } },
    { date: '2026-08-03', totals: { kcal: 2300 }, weightKg: 69.8 },
    { date: '2026-08-04', totals: { kcal: 0 } },
  ], 2000), {
    averageKcal: 2033,
    recordedDays: 3,
    onTargetDays: 2,
    latestWeightKg: 69.8,
    latestWeightDate: '2026-08-03',
  });
});

test('monthDashboardSummary returns explicit empty values when nothing was recorded', () => {
  assert.deepEqual(monthDashboardSummary([], 2000), {
    averageKcal: null,
    recordedDays: 0,
    onTargetDays: 0,
    latestWeightKg: null,
    latestWeightDate: null,
  });
});

test('monthDashboardSummary uses the later dated weight regardless of input order', () => {
  assert.equal(monthDashboardSummary([
    { date: '2026-08-14', totals: { kcal: 1000 }, weightKg: 68.1 },
    { date: '2026-08-02', totals: { kcal: 1000 }, weightKg: 69.4 },
  ], 2000).latestWeightKg, 68.1);
});

test('monthDashboardSummary rejects invalid target and day inputs', () => {
  for (const target of [0, -1, NaN, '2000']) {
    assert.throws(() => monthDashboardSummary([], target), TypeError);
  }
  assert.throws(() => monthDashboardSummary(null, 2000), TypeError);
  assert.throws(() => monthDashboardSummary([{ date: '2026-08-01', totals: { kcal: -1 } }], 2000), TypeError);
});

test('progressPercent maps calories to a capped whole-number visual percentage', () => {
  assert.equal(progressPercent(0, 2000), 0);
  assert.equal(progressPercent(623, 2000), 31);
  assert.equal(progressPercent(2000, 2000), 100);
  assert.equal(progressPercent(2500, 2000), 100);
});

test('progressPercent rejects invalid values instead of emitting broken CSS', () => {
  for (const value of [-1, NaN, '623']) {
    assert.throws(() => progressPercent(value, 2000), TypeError);
  }
  for (const target of [0, -1, NaN, '2000']) {
    assert.throws(() => progressPercent(623, target), TypeError);
  }
});

test('servingChoiceOptions turns a category reference into four bowl choices', () => {
  assert.deepEqual(servingChoiceOptions({ amount: 700, unit: 'g' }), [
    { label: '반 그릇', amount: 350, unit: 'g', selected: false },
    { label: '한 그릇', amount: 700, unit: 'g', selected: true },
    { label: '한 그릇 반', amount: 1050, unit: 'g', selected: false },
    { label: '두 그릇', amount: 1400, unit: 'g', selected: false },
  ]);
});

test('servingChoiceOptions preserves one decimal place and rejects invalid estimates', () => {
  assert.equal(servingChoiceOptions({ amount: 33.3, unit: 'mL' })[2].amount, 50);
  for (const estimate of [null, {}, { amount: 0, unit: 'g' }, { amount: 1, unit: '' }]) {
    assert.throws(() => servingChoiceOptions(estimate), TypeError);
  }
});
