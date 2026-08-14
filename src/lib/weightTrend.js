const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function formatValue(value) {
  return Number.isNaN(value) ? 'NaN' : JSON.stringify(value);
}

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function normalizePoints(points, functionName) {
  if (!Array.isArray(points)) {
    throw new TypeError(
      `${functionName}: points must be an array, got ${formatValue(points)}`,
    );
  }

  const correctedByDate = new Map();

  for (const [index, point] of points.entries()) {
    if (!isObject(point)) {
      throw new TypeError(
        `${functionName}: points[${index}] must be an object, got ${formatValue(point)}`,
      );
    }

    if (!DATE_PATTERN.test(point.date)) {
      throw new Error(
        `${functionName}: points[${index}].date must match YYYY-MM-DD, got ${formatValue(point.date)}`,
      );
    }

    if (typeof point.weightKg !== 'number') {
      throw new TypeError(
        `${functionName}: points[${index}].weightKg must be a number, got ${formatValue(point.weightKg)}`,
      );
    }
    if (Number.isNaN(point.weightKg)) {
      throw new Error(
        `${functionName}: points[${index}].weightKg must not be NaN, got NaN`,
      );
    }
    if (point.weightKg <= 0) {
      throw new Error(
        `${functionName}: points[${index}].weightKg must be positive, got ${point.weightKg}`,
      );
    }

    // 같은 날짜의 뒤 기록은 앞 기록을 정정한 값이다.
    correctedByDate.set(point.date, {
      date: point.date,
      weightKg: point.weightKg,
    });
  }

  return [...correctedByDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

function localNoon(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  // 자정 대신 정오를 써서 DST 경계에서도 날짜가 전후로 밀리지 않게 한다.
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

function daysBetween(earlierDate, laterDate) {
  return Math.round(
    (localNoon(laterDate).getTime() - localNoon(earlierDate).getTime()) /
      MILLISECONDS_PER_DAY,
  );
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

function calculateWeeklyChange(points) {
  if (points.length < 2) return null;

  const firstDate = points[0].date;
  const spanDays = daysBetween(firstDate, points.at(-1).date);
  if (spanDays === 0) return null;

  const samples = points.map(({ date, weightKg }) => ({
    x: daysBetween(firstDate, date),
    y: weightKg,
  }));
  const meanX = samples.reduce((total, sample) => total + sample.x, 0) /
    samples.length;
  const meanY = samples.reduce((total, sample) => total + sample.y, 0) /
    samples.length;

  let numerator = 0;
  let denominator = 0;
  // 모든 표본을 쓰는 최소제곱 직선의 kg/일 기울기를 구한다.
  for (const sample of samples) {
    const xDifference = sample.x - meanX;
    numerator += xDifference * (sample.y - meanY);
    denominator += xDifference ** 2;
  }

  const kgPerWeek = roundToTwoDecimals((numerator / denominator) * 7);
  return { kgPerWeek, spanDays, sampleCount: points.length };
}

export function movingAverageKg(points, windowDays) {
  const normalized = normalizePoints(points, 'movingAverageKg');

  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error(
      `movingAverageKg: windowDays must be an integer of at least 1, got ${formatValue(windowDays)}`,
    );
  }

  return normalized.map((current) => {
    const samples = normalized.filter((candidate) => {
      const ageDays = daysBetween(candidate.date, current.date);
      return ageDays >= 0 && ageDays < windowDays;
    });
    const totalKg = samples.reduce((total, sample) => total + sample.weightKg, 0);

    return {
      date: current.date,
      avgKg: roundToOneDecimal(totalKg / samples.length),
      sampleCount: samples.length,
    };
  });
}

export function weeklyChangeKg(points) {
  const normalized = normalizePoints(points, 'weeklyChangeKg');
  return calculateWeeklyChange(normalized);
}

export function summarizeWeightTrend(
  points,
  { flatThresholdKgPerWeek = 0.1 } = {},
) {
  const normalized = normalizePoints(points, 'summarizeWeightTrend');

  if (
    typeof flatThresholdKgPerWeek !== 'number' ||
    Number.isNaN(flatThresholdKgPerWeek) ||
    flatThresholdKgPerWeek < 0
  ) {
    throw new Error(
      `summarizeWeightTrend: flatThresholdKgPerWeek must be a non-negative number, got ${formatValue(flatThresholdKgPerWeek)}`,
    );
  }

  const change = calculateWeeklyChange(normalized);
  const latest = normalized.at(-1);

  if (change === null) {
    return {
      direction: 'unknown',
      kgPerWeek: null,
      spanDays: null,
      sampleCount: normalized.length,
      latestKg: latest?.weightKg ?? null,
      latestDate: latest?.date ?? null,
    };
  }

  let direction = 'flat';
  if (change.kgPerWeek <= -flatThresholdKgPerWeek) direction = 'down';
  else if (change.kgPerWeek >= flatThresholdKgPerWeek) direction = 'up';

  return {
    direction,
    ...change,
    latestKg: latest.weightKg,
    latestDate: latest.date,
  };
}
