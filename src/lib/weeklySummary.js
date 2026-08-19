const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUTRIENTS = ['kcal', 'carbG', 'proteinG', 'fatG'];

function parseDateKey(value) {
  if (!DATE_RE.test(value)) throw new TypeError('date must be YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) throw new TypeError('date must be a real YYYY-MM-DD date');
  return date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

export function sevenDayKeys(endDate) {
  const end = parseDateKey(endDate);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (6 - index));
    return dateKey(date);
  });
}

export function summarizeSevenDays(days, endDate) {
  if (!Array.isArray(days)) throw new TypeError('days must be an array');
  const keys = sevenDayKeys(endDate);
  const allowed = new Set(keys);
  const inRange = days.filter((day) => day && allowed.has(day.date)).sort((a, b) => a.date.localeCompare(b.date));
  const recorded = inRange.filter((day) => Number(day.totals?.kcal) > 0);
  const weights = inRange.filter((day) => typeof day.weightKg === 'number' && Number.isFinite(day.weightKg));

  const averages = recorded.length === 0 ? null : Object.fromEntries(NUTRIENTS.map((field) => [
    field,
    roundOne(recorded.reduce((sum, day) => sum + Number(day.totals?.[field] ?? 0), 0) / recorded.length),
  ]));
  const firstKg = weights[0]?.weightKg ?? null;
  const lastKg = weights.at(-1)?.weightKg ?? null;

  return {
    startDate: keys[0], endDate: keys.at(-1), recordedDays: recorded.length, averages,
    weight: {
      count: weights.length, firstKg, lastKg,
      changeKg: weights.length < 2 ? null : roundOne(lastKg - firstKg),
    },
  };
}
