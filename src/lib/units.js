const NUTRIENT_KEYS = ['kcal', 'carbG', 'proteinG', 'fatG'];

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

export function scaleNutrients(per100g, amountG) {
  if (amountG < 0 || Number.isNaN(amountG)) throw new RangeError();

  return Object.fromEntries(NUTRIENT_KEYS.map((key) => {
    if (!Object.hasOwn(per100g, key) || per100g[key] === null) return [key, null];
    return [key, roundToOneDecimal(per100g[key] * amountG / 100)];
  }));
}

export function kjToKcal(kj) {
  if (kj === null) return null;
  if (kj < 0 || Number.isNaN(kj)) throw new RangeError();
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
