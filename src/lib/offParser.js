const NUTRIENT_FIELDS = [
  ['kcal', 'energy-kcal'],
  ['proteinG', 'proteins'],
  ['fatG', 'fat'],
  ['carbG', 'carbohydrates'],
];

function parseNutrient(nutriments, label, field, code) {
  if (!Object.hasOwn(nutriments, field)) return null;

  const value = nutriments[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `parseOffProduct: ${label} is not a valid number, got ${JSON.stringify(value)} for ${code}`,
    );
  }
  if (value < 0) {
    throw new Error(
      `parseOffProduct: ${label} is not a valid number, got ${JSON.stringify(value)} for ${code}, must not be negative`,
    );
  }

  return value;
}

export function parseOffProduct(response) {
  if (response.status !== 1 || !response.product) return null;

  const { product } = response;
  const identity = {
    code: response.code,
    name: product.product_name ?? null,
    brand: product.brands ?? null,
  };

  if (product.nutrition_data_per == null) {
    return {
      ...identity,
      unit: null,
      per100: null,
    };
  }

  let unit;
  if (product.nutrition_data_per === '100g') {
    unit = 'g';
  } else if (product.nutrition_data_per === '100ml') {
    unit = 'ml';
  } else {
    throw new Error(
      `parseOffProduct: unexpected nutrition_data_per ${JSON.stringify(product.nutrition_data_per)} for ${response.code}`,
    );
  }

  return {
    ...identity,
    unit,
    per100: Object.fromEntries(
      NUTRIENT_FIELDS.map(([label, field]) => [
        label,
        parseNutrient(product.nutriments ?? {}, label, field, response.code),
      ]),
    ),
  };
}
