import { dayStatus } from './calendarGrid.js';

function displayValue(value) {
  return Number.isNaN(value) ? 'NaN' : JSON.stringify(value);
}

function assertNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative number, got ${displayValue(value)}`);
  }
}

function assertPositiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive number, got ${displayValue(value)}`);
  }
}

export function progressPercent(value, target) {
  assertNonNegativeNumber(value, 'progressPercent: value');
  assertPositiveNumber(target, 'progressPercent: target');
  return Math.min(100, Math.round((value / target) * 100));
}

export function servingChoiceOptions(estimate) {
  if (!estimate || typeof estimate !== 'object' || Array.isArray(estimate)) {
    throw new TypeError(`servingChoiceOptions: estimate must be an object, got ${displayValue(estimate)}`);
  }
  assertPositiveNumber(estimate.amount, 'servingChoiceOptions: amount');
  if (typeof estimate.unit !== 'string' || estimate.unit.trim() === '') {
    throw new TypeError(`servingChoiceOptions: unit must be a non-empty string, got ${displayValue(estimate.unit)}`);
  }

  return [
    ['반 그릇', 0.5],
    ['한 그릇', 1],
    ['한 그릇 반', 1.5],
    ['두 그릇', 2],
  ].map(([label, multiplier]) => ({
    label,
    amount: Math.round((estimate.amount * multiplier + 1e-9) * 10) / 10,
    unit: estimate.unit,
    selected: multiplier === 1,
  }));
}

export function monthDashboardSummary(days, targetKcal) {
  if (!Array.isArray(days)) {
    throw new TypeError(`monthDashboardSummary: days must be an array, got ${displayValue(days)}`);
  }
  assertPositiveNumber(targetKcal, 'monthDashboardSummary: targetKcal');

  let kcalTotal = 0;
  let recordedDays = 0;
  let onTargetDays = 0;
  let latestWeightKg = null;
  let latestWeightDate = null;

  for (const day of days) {
    if (!day || typeof day !== 'object' || Array.isArray(day)) {
      throw new TypeError(`monthDashboardSummary: day must be an object, got ${displayValue(day)}`);
    }
    if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
      throw new TypeError(`monthDashboardSummary: invalid date ${displayValue(day.date)}`);
    }

    const kcal = day.totals?.kcal ?? 0;
    assertNonNegativeNumber(kcal, `monthDashboardSummary: ${day.date} kcal`);
    if (kcal > 0) {
      kcalTotal += kcal;
      recordedDays += 1;
      if (dayStatus({ kcal, targetKcal, hasRecord: true }) === 'ok') onTargetDays += 1;
    }

    if (day.weightKg !== undefined && day.weightKg !== null) {
      assertPositiveNumber(day.weightKg, `monthDashboardSummary: ${day.date} weightKg`);
      if (latestWeightDate === null || day.date > latestWeightDate) {
        latestWeightKg = day.weightKg;
        latestWeightDate = day.date;
      }
    }
  }

  return {
    averageKcal: recordedDays === 0 ? null : Math.round(kcalTotal / recordedDays),
    recordedDays,
    onTargetDays,
    latestWeightKg,
    latestWeightDate,
  };
}
