const NUTRIENT_FIELDS = [
  ['kcal', 'AMT_NUM1'],
  ['proteinG', 'AMT_NUM3'],
  ['fatG', 'AMT_NUM4'],
  ['carbG', 'AMT_NUM6'],
];

function parseNutrient(item, label, field) {
  const value = item[field];
  if (value === '') return null;

  const number = Number(value);
  if (Number.isNaN(number)) {
    throw new Error(
      `parseMfdsFoodItem: ${label} is not a valid number, got ${JSON.stringify(value)} for ${item.FOOD_CD}`,
    );
  }
  if (number < 0) {
    throw new Error(
      `parseMfdsFoodItem: ${label} must not be negative, got ${JSON.stringify(value)} for ${item.FOOD_CD}`,
    );
  }

  return number;
}

export function parseMfdsFoodItem(item) {
  if (item.SERVING_SIZE !== '100g') {
    throw new Error(
      `parseMfdsFoodItem: expected SERVING_SIZE "100g", got ${JSON.stringify(item.SERVING_SIZE)} for ${item.FOOD_CD}`,
    );
  }

  return {
    foodCode: item.FOOD_CD,
    name: item.FOOD_NM_KR,
    category: item.FOOD_CAT1_NM,
    per100g: Object.fromEntries(
      NUTRIENT_FIELDS.map(([label, field]) => [label, parseNutrient(item, label, field)]),
    ),
  };
}

export function parseMfdsSearchResponse(response) {
  if (response.header.resultCode !== '00') {
    throw new Error(
      `parseMfdsSearchResponse: API error ${response.header.resultCode} ${response.header.resultMsg}`,
    );
  }

  if (response.body.totalCount === 0 || !response.body.items) return [];

  const rawItems = response.body.items;
  let items;

  if (Array.isArray(rawItems)) {
    items = rawItems;
  } else if (typeof rawItems === 'object') {
    const { item } = rawItems;
    items = Array.isArray(item) ? item : [item];
  } else {
    throw new TypeError(
      `parseMfdsSearchResponse: unexpected items shape, got ${JSON.stringify(rawItems)}`,
    );
  }

  return items.map(parseMfdsFoodItem);
}
