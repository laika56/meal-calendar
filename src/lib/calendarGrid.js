function localDate(year, monthIndex, dayOfMonth) {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, monthIndex, dayOfMonth);
  return date;
}

function formatLocalDate(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertGridInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `buildMonthGrid: ${label} must be an integer between ${minimum} and ${maximum}, got ${formatValue(value)}`,
    );
  }
}

function formatValue(value) {
  return Number.isNaN(value) ? 'NaN' : JSON.stringify(value);
}

export function buildMonthGrid({ year, month, weekStartsOn = 0 }) {
  assertGridInteger(year, 1, 9999, 'year');
  assertGridInteger(month, 1, 12, 'month');
  assertGridInteger(weekStartsOn, 0, 6, 'weekStartsOn');

  const monthIndex = month - 1;
  const firstOfMonth = localDate(year, monthIndex, 1);
  const leadingDays = (firstOfMonth.getDay() - weekStartsOn + 7) % 7;
  const daysInMonth = localDate(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.max(35, Math.ceil((leadingDays + daysInMonth) / 7) * 7);

  return Array.from({ length: cellCount }, (_, index) => {
    const date = localDate(year, monthIndex, 1 - leadingDays + index);
    return {
      date: formatLocalDate(date),
      dayOfMonth: date.getDate(),
      weekday: date.getDay(),
      inCurrentMonth: date.getFullYear() === year && date.getMonth() === monthIndex,
    };
  });
}

export function dayStatus({ kcal, targetKcal, hasRecord }) {
  if (hasRecord === false) return 'none';

  if (typeof kcal !== 'number' || Number.isNaN(kcal) || kcal < 0) {
    throw new TypeError(
      `dayStatus: kcal must be a non-negative number, got ${formatValue(kcal)}`,
    );
  }
  if (typeof targetKcal !== 'number' || Number.isNaN(targetKcal) || targetKcal <= 0) {
    throw new TypeError(
      `dayStatus: targetKcal must be a positive number, got ${formatValue(targetKcal)}`,
    );
  }

  const ratio = kcal / targetKcal;
  if (ratio < 0.9) return 'under';
  if (ratio <= 1.1) return 'ok';
  return 'over';
}
