import assert from 'node:assert/strict';
import test from 'node:test';

import { sevenDayKeys, summarizeSevenDays } from '../src/lib/weeklySummary.js';

test('builds seven inclusive local date keys across a month boundary', () => {
  assert.deepEqual(sevenDayKeys('2026-09-02'), [
    '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30',
    '2026-08-31', '2026-09-01', '2026-09-02',
  ]);
});

test('averages only recorded days and summarizes first and last weights', () => {
  const summary = summarizeSevenDays([
    { date: '2026-08-14', totals: { kcal: 1000, carbG: 100, proteinG: 50, fatG: 30 }, weightKg: 70 },
    { date: '2026-08-15', totals: { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 }, weightKg: 69.8 },
    { date: '2026-08-16', totals: { kcal: 1500, carbG: 150, proteinG: 70, fatG: 40 } },
  ], '2026-08-16');

  assert.deepEqual(summary, {
    startDate: '2026-08-10', endDate: '2026-08-16', recordedDays: 2,
    averages: { kcal: 1250, carbG: 125, proteinG: 60, fatG: 35 },
    weight: { count: 2, firstKg: 70, lastKg: 69.8, changeKg: -0.2 },
  });
});

test('does not turn no records or one weight into a zero average or zero change', () => {
  assert.deepEqual(summarizeSevenDays([{ date: '2026-08-19', weightKg: 70 }], '2026-08-19'), {
    startDate: '2026-08-13', endDate: '2026-08-19', recordedDays: 0,
    averages: null,
    weight: { count: 1, firstKg: 70, lastKg: 70, changeKg: null },
  });
});
