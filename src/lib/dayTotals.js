const NUTRIENT_KEYS = ['kcal', 'carbG', 'proteinG', 'fatG'];
const SLOT_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function formatValue(value) {
  return Number.isNaN(value) ? 'NaN' : JSON.stringify(value);
}

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

export function sumEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError(
      `sumEntries: entries must be an array, got ${JSON.stringify(entries)}`,
    );
  }

  const totals = { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 };

  for (const [index, entry] of entries.entries()) {
    if (!isObject(entry)) {
      throw new TypeError(
        `sumEntries: entries[${index}] must be an object, got ${JSON.stringify(entry)}`,
      );
    }

    for (const field of NUTRIENT_KEYS) {
      const value = entry[field];
      // 영양성분표에 없는 탄·단·지는 entry에서 null로 보존한다. 합계에는 알려진
      // 값만 더하고, 화면이 해당 날짜의 null 존재를 따로 표시한다.
      if (value === null) continue;
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new TypeError(
          `sumEntries: entries[${index}].${field} must be a number, got ${formatValue(value)}`,
        );
      }
      if (value < 0) {
        throw new RangeError(
          `sumEntries: entries[${index}].${field} must not be negative, got ${value}`,
        );
      }
      totals[field] += value;
    }
  }

  return Object.fromEntries(
    NUTRIENT_KEYS.map((field) => [field, roundToOneDecimal(totals[field])]),
  );
}

export function calcDayTotals(slots) {
  if (!isObject(slots)) {
    throw new TypeError(
      `calcDayTotals: slots must be an object, got ${JSON.stringify(slots)}`,
    );
  }

  const allEntries = [];

  for (const key of SLOT_KEYS) {
    const entries = slots[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      throw new TypeError(
        `calcDayTotals: slots.${key} must be an array, got ${JSON.stringify(entries)}`,
      );
    }
    allEntries.push(...entries);
  }

  return sumEntries(allEntries);
}

export function totalsMatch(a, b) {
  if (!isObject(a) || !isObject(b)) return false;

  return NUTRIENT_KEYS.every((field) => {
    const aValue = a[field];
    const bValue = b[field];
    if (typeof aValue !== 'number' || typeof bValue !== 'number') return false;
    return aValue === bValue || Math.abs(aValue - bValue) <= 0.05;
  });
}
