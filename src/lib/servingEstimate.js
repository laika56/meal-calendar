function formatValue(value) {
  if (Number.isNaN(value)) return 'NaN';

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function estimateServingFromCategory(parsed, table) {
  if (!isObject(parsed)) {
    throw new TypeError(
      `estimateServingFromCategory: parsed must be an object, got ${formatValue(parsed)}`,
    );
  }

  if (!isObject(table) || !isObject(table.categories)) {
    const invalidCategories = isObject(table) ? table.categories : table;
    throw new TypeError(
      `estimateServingFromCategory: table.categories must be an object, got ${formatValue(invalidCategories)}`,
    );
  }

  if (parsed.basis !== 'g' && parsed.basis !== 'mL') {
    throw new TypeError(
      `estimateServingFromCategory: parsed.basis must be "g" or "mL", got ${formatValue(parsed.basis)}`,
    );
  }

  if (parsed.category == null || parsed.category === '') return null;

  const statistics = table.categories[parsed.category]?.[parsed.basis];
  if (statistics == null) return null;

  return {
    amount: statistics.median,
    unit: parsed.basis,
    source: 'category-median',
    category: parsed.category,
    sampleCount: statistics.sampleCount,
    min: statistics.min,
    max: statistics.max,
    p25: statistics.p25,
    p75: statistics.p75,
  };
}
