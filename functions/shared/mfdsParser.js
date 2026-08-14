const NUTRIENT_FIELDS = [
  ['kcal', 'AMT_NUM1'],
  ['proteinG', 'AMT_NUM3'],
  ['fatG', 'AMT_NUM4'],
  ['carbG', 'AMT_NUM6'],
];

function formatValue(value) {
  if (Number.isNaN(value)) return 'NaN';

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function parseNumber(value) {
  if (typeof value === 'string' && value.includes(',')) {
    const normalized = value.trim();
    if (!/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(normalized)) return Number.NaN;
    return Number(normalized.replace(/,/g, ''));
  }

  return Number(value);
}

function parseNutrient(item, label, field) {
  const value = item[field];
  if (value === '') return null;

  const number = parseNumber(value);
  if (Number.isNaN(number)) {
    throw new Error(
      `parseMfdsFoodItem: ${label} is not a valid number, got ${formatValue(value)} for ${item.FOOD_CD}`,
    );
  }
  if (number < 0) {
    throw new Error(
      `parseMfdsFoodItem: ${label} must not be negative, got ${formatValue(value)} for ${item.FOOD_CD}`,
    );
  }

  return number;
}

function parseBasis(item) {
  const value = item.SERVING_SIZE;
  if (typeof value !== 'string') {
    throw new Error(
      `parseMfdsFoodItem: expected SERVING_SIZE "100g" or "100mL", got ${formatValue(value)} for ${item.FOOD_CD}`,
    );
  }

  const normalized = value.trim();
  if (normalized === '100g') return 'g';
  if (normalized.toLowerCase() === '100ml') return 'mL';

  throw new Error(
    `parseMfdsFoodItem: expected SERVING_SIZE "100g" or "100mL", got ${JSON.stringify(value)} for ${item.FOOD_CD}`,
  );
}

function parseAmount(item, field, label) {
  const value = item[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new TypeError(
      `parseMfdsFoodItem: ${label} must be a string or null, got ${formatValue(value)} for ${item.FOOD_CD}`,
    );
  }

  const normalized = value.trim();
  if (normalized === '') return null;

  const match = /^((?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?)\s*(g|ml)?$/i.exec(normalized);
  if (!match) {
    return { amount: null, unit: null, note: normalized };
  }

  const number = Number(match[1].replace(/,/g, ''));
  if (number <= 0) {
    return { amount: null, unit: null, note: normalized };
  }

  return {
    amount: number,
    unit: match[2] ? (match[2].toLowerCase() === 'g' ? 'g' : 'mL') : null,
    note: null,
  };
}

function parseMaker(item) {
  const value = item.MAKER_NM;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new TypeError(
      `parseMfdsFoodItem: maker must be a string or null, got ${formatValue(value)} for ${item.FOOD_CD}`,
    );
  }

  return value.trim() || null;
}

function parseFoodGroup(item) {
  const value = item.DB_GRP_CM;
  if (value === null || value === undefined) return 'unknown';
  if (typeof value !== 'string') {
    throw new TypeError(
      `parseMfdsFoodItem: foodGroup must be a string or null, got ${formatValue(value)} for ${item.FOOD_CD}`,
    );
  }

  if (value === 'D') return 'dish';
  if (value === 'P') return 'processed';
  if (value === 'R1') return 'ingredient';
  return 'unknown';
}

export function parseMfdsFoodItem(item) {
  const basis = parseBasis(item);
  const per100g = Object.fromEntries(
    NUTRIENT_FIELDS.map(([label, field]) => [label, parseNutrient(item, label, field)]),
  );
  const total = parseAmount(item, 'Z10500', 'totalAmount');
  const serving = parseAmount(item, 'NUTRI_AMOUNT_SERVING', 'servingAmount');

  return {
    foodCode: item.FOOD_CD,
    name: item.FOOD_NM_KR,
    category: item.FOOD_CAT1_NM,
    per100g,
    basis,
    maker: parseMaker(item),
    isFranchise: item.FOOD_OR_CD === '2',
    foodGroup: parseFoodGroup(item),
    totalAmount: total?.amount ?? null,
    totalUnit: total?.unit ?? null,
    totalNote: total?.note ?? null,
    servingAmount: serving?.amount ?? null,
    servingUnit: serving?.unit ?? null,
    servingNote: serving?.note ?? null,
  };
}

export function resolveServing(parsed) {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError(`resolveServing: parsed must be an object, got ${formatValue(parsed)}`);
  }

  if (
    parsed.foodGroup === 'dish'
    && parsed.totalAmount != null
    && (parsed.totalUnit == null || parsed.totalUnit === parsed.basis)
  ) {
    return {
      amount: parsed.totalAmount,
      unit: parsed.basis,
      source: 'dish-total',
    };
  }

  if (
    parsed.servingAmount != null
    && (parsed.servingUnit == null || parsed.servingUnit === parsed.basis)
  ) {
    return {
      amount: parsed.servingAmount,
      unit: parsed.basis,
      source: 'serving-field',
    };
  }

  return null;
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
