const NUTRIENT_KEYS = ['kcal', 'carbG', 'proteinG', 'fatG'];

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function formatValue(value) {
  return Number.isNaN(value) ? 'NaN' : JSON.stringify(value);
}

export function scaleNutrients(per100g, amountG) {
  if (typeof amountG !== 'number') {
    throw new RangeError(
      `scaleNutrients: amountG must be a number, got ${JSON.stringify(amountG)}`,
    );
  }
  if (Number.isNaN(amountG)) {
    throw new RangeError('scaleNutrients: amountG must be a number, got NaN');
  }
  if (amountG < 0) {
    throw new RangeError(`scaleNutrients: amountG must not be negative, got ${amountG}`);
  }

  return Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    if (!Object.hasOwn(per100g, key) || per100g[key] === null) return [key, null];
    if (typeof per100g[key] !== 'number' || Number.isNaN(per100g[key])) {
      throw new TypeError(
        `scaleNutrients: per100g.${key} must be a number or null, got ${formatValue(per100g[key])}`,
      );
    }
    return [key, roundToOneDecimal(per100g[key] * amountG / 100)];
  }));
}

export function kjToKcal(kj) {
  if (kj === null) return null;
  if (typeof kj !== 'number') {
    throw new TypeError(`kjToKcal: kj must be a number or null, got ${formatValue(kj)}`);
  }
  if (Number.isNaN(kj)) {
    throw new RangeError('kjToKcal: kj must be a number, got NaN');
  }
  if (kj < 0) throw new RangeError(`kjToKcal: kj must not be negative, got ${kj}`);
  return roundToOneDecimal(kj / 4.184);
}

export function checkCalorieConsistency({ kcal, carbG, proteinG, fatG }) {
  if ([kcal, carbG, proteinG, fatG].some((value) => value === null) || kcal === 0) {
    return { ok: null, calculatedKcal: null, deviation: null };
  }

  const calculatedKcal = carbG * 4 + proteinG * 4 + fatG * 9;
  const deviation = Math.abs(calculatedKcal - kcal) / kcal;

  return {
    ok: deviation <= 0.20,
    calculatedKcal: roundToOneDecimal(calculatedKcal),
    deviation: Math.round(deviation * 1000) / 1000,
  };
}
