const SOURCE_TYPES = new Set(['official_brand', 'public_data', 'general_reference']);
const CONFIDENCE_VALUES = new Set(['official', 'public', 'reference']);
const BASIS_UNITS = new Set(['g', 'mL', '개', '잔', '조각', '15cm', '30cm']);
const NUTRIENT_KEYS = new Set(['kcal', 'carbG', 'proteinG', 'fatG', 'sugarG', 'sodiumMg']);
const REQUIRED_RECORD_KEYS = new Set([
  'id',
  'brandId',
  'brandName',
  'name',
  'aliases',
  'normalizedName',
  'searchTokens',
  'category',
  'basis',
  'nutrients',
  'sourceId',
  'sourceType',
  'sourceUrl',
  'sourceUpdatedAt',
  'verifiedAt',
  'confidence',
  'active',
  'createdAt',
  'updatedAt',
]);
const REQUIRED_BASIS_KEYS = new Set(['amount', 'unit', 'label']);
const CATALOG_SEARCH_TOKENS = new WeakMap();
const REVIEWED_BRAND_IDENTITIES = new Map([
  ['써브웨이', 'subway'],
  ['서브웨이', 'subway'],
  ['subway', 'subway'],
]);

function assertPlainObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertClosedShape(value, allowedKeys, label) {
  assertPlainObject(value, label);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(`${label} has unknown key ${key}`);
  }

  for (const key of allowedKeys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing required key ${key}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertCanonicalText(value, label) {
  assertNonEmptyString(value, label);
  if (value !== normalizeCatalogText(value)) {
    throw new TypeError(`${label} must be canonical`);
  }
}

function assertDate(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${label} must be an ISO UTC date`);
  }
}

function assertUrl(value) {
  assertNonEmptyString(value, 'sourceUrl');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('sourceUrl must be an absolute http or https URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('sourceUrl must be an absolute http or https URL');
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateBasis(value) {
  assertClosedShape(value, REQUIRED_BASIS_KEYS, 'basis');
  if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0) {
    throw new TypeError('basis.amount must be a finite positive number');
  }
  if (!BASIS_UNITS.has(value.unit)) {
    throw new TypeError(`basis.unit must be one of ${[...BASIS_UNITS].join(', ')}`);
  }
  assertNonEmptyString(value.label, 'basis.label');
}

function validateNutrients(value) {
  assertPlainObject(value, 'nutrients');
  let presentCount = 0;

  for (const key of Object.keys(value)) {
    if (!NUTRIENT_KEYS.has(key)) throw new TypeError(`nutrients has unknown key ${key}`);
  }
  for (const key of NUTRIENT_KEYS) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`nutrients is missing required key ${key}`);
    const nutrient = value[key];
    if (nutrient !== null && (typeof nutrient !== 'number' || !Number.isFinite(nutrient) || nutrient < 0)) {
      throw new TypeError(`${key} must be null or a finite non-negative number`);
    }
    if (nutrient !== null) presentCount += 1;
  }
  if (presentCount === 0) throw new TypeError('nutrients must contain at least one reviewed value');
}

function validateCanonicalTextArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    assertNonEmptyString(item, `${label}[${index}]`);
    const normalized = normalizeCatalogText(item);
    if (seen.has(normalized)) {
      throw new TypeError(`${label} contains duplicate normalized token ${normalized}`);
    }
    assertCanonicalText(item, `${label}[${index}]`);
    seen.add(normalized);
  }
}

export function normalizeCatalogText(value) {
  if (typeof value !== 'string') throw new TypeError('normalizeCatalogText: value must be a string');
  return value.normalize('NFC').trim().toLocaleLowerCase('ko-KR')
    .replace(/[™®.]/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateCatalogRecord(value) {
  assertClosedShape(value, REQUIRED_RECORD_KEYS, 'catalog record');
  for (const key of ['id', 'brandId', 'brandName', 'name', 'category', 'sourceId']) {
    assertNonEmptyString(value[key], key);
  }
  validateCanonicalTextArray(value.aliases, 'aliases');
  validateCanonicalTextArray(value.searchTokens, 'searchTokens');
  assertCanonicalText(value.normalizedName, 'normalizedName');
  if (value.normalizedName !== normalizeCatalogText(value.name)) {
    throw new TypeError('normalizedName must equal normalized name');
  }
  validateBasis(value.basis);
  validateNutrients(value.nutrients);
  if (!SOURCE_TYPES.has(value.sourceType)) {
    throw new TypeError(`sourceType must be one of ${[...SOURCE_TYPES].join(', ')}`);
  }
  assertUrl(value.sourceUrl);
  assertDate(value.sourceUpdatedAt, 'sourceUpdatedAt', true);
  assertDate(value.verifiedAt, 'verifiedAt');
  if (!CONFIDENCE_VALUES.has(value.confidence)) {
    throw new TypeError(`confidence must be one of ${[...CONFIDENCE_VALUES].join(', ')}`);
  }
  if (typeof value.active !== 'boolean') throw new TypeError('active must be a boolean');
  assertDate(value.createdAt, 'createdAt');
  assertDate(value.updatedAt, 'updatedAt');

  return deepFreeze(structuredClone(value));
}

function sourceLabel(sourceType) {
  if (sourceType === 'official_brand') return '공식값';
  if (sourceType === 'public_data') return '공공데이터';
  return '참고값';
}

function toCompatibilityNutrient(value, basis) {
  if (basis.unit !== 'g' && basis.unit !== 'mL') return null;
  if (value === null) return null;
  return (value * 100) / basis.amount;
}

export function catalogRecordToSearchFood(record) {
  const validated = validateCatalogRecord(record);
  const { basis, nutrients } = validated;
  const coreNutrients = {
    kcal: toCompatibilityNutrient(nutrients.kcal, basis),
    carbG: toCompatibilityNutrient(nutrients.carbG, basis),
    proteinG: toCompatibilityNutrient(nutrients.proteinG, basis),
    fatG: toCompatibilityNutrient(nutrients.fatG, basis),
  };

  const searchFood = {
    foodKey: `catalog_${validated.id}`,
    name: validated.name,
    category: validated.category,
    maker: validated.brandName,
    isFranchise: true,
    per100g: coreNutrients,
    basis: basis.unit,
    servingNutrients: nutrients,
    serving: { amount: basis.amount, unit: basis.unit, source: 'official-serving' },
    completeness: [nutrients.kcal, nutrients.carbG, nutrients.proteinG, nutrients.fatG]
      .every((value) => value !== null) ? 'complete' : 'partial',
    source: {
      type: validated.sourceType,
      label: sourceLabel(validated.sourceType),
      url: validated.sourceUrl,
      verifiedAt: validated.verifiedAt,
    },
  };
  CATALOG_SEARCH_TOKENS.set(searchFood, validated.searchTokens);
  return searchFood;
}

function catalogQueryTokens(query) {
  const normalized = normalizeCatalogText(query);
  if (normalized === '') return [];
  return [...new Set(normalized.split(' ').flatMap((token) => token
    .split(/(?<=[가-힣])(?=[a-z0-9])|(?<=[a-z0-9])(?=[가-힣])/u)
    .filter(Boolean)))];
}

function assertCatalogManifest(value, label, { status } = {}) {
  assertPlainObject(value, label);
  if (typeof value.runId !== 'string' || value.runId === '') {
    throw new TypeError(`${label}.runId must be a non-empty string`);
  }
  assertPlainObject(value.counts, `${label}.counts`);
  for (const key of ['sources', 'brands', 'foods']) {
    if (!Number.isSafeInteger(value.counts[key]) || value.counts[key] < 0) {
      throw new TypeError(`${label}.counts.${key} must be a non-negative safe integer`);
    }
  }
  for (const key of ['catalogSha256', 'payloadSha256']) {
    if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(value[key])) {
      throw new TypeError(`${label}.${key} must be a SHA-256 hex string`);
    }
  }
  if (status !== undefined && value.status !== status) {
    throw new Error(`${label}.status must be ${status}`);
  }
}

function sameCatalogManifest(pointer, run) {
  return pointer.runId === run.runId
    && pointer.counts.sources === run.counts.sources
    && pointer.counts.brands === run.counts.brands
    && pointer.counts.foods === run.counts.foods
    && pointer.catalogSha256 === run.catalogSha256
    && pointer.payloadSha256 === run.payloadSha256;
}

/**
 * Queries the ready catalog snapshot through a single indexed token lookup.
 * This accepts a Firestore-compatible database, but is deliberately never
 * called by browser code: browser clients cannot read the catalog collections.
 */
export async function queryCatalogFoods(db, query, limit = 100) {
  if (!db || typeof db.doc !== 'function' || typeof db.collection !== 'function') {
    throw new TypeError('db must be Firestore-compatible');
  }
  if (typeof query !== 'string') throw new TypeError('query must be a string');
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError('limit must be a positive safe integer');
  }

  const tokens = catalogQueryTokens(query);
  if (tokens.length === 0) return { items: [], hasMore: false };
  const strongestToken = tokens.reduce((strongest, token) => (
    token.length >= strongest.length ? token : strongest
  ));

  const pointerSnapshot = await db.doc('franchiseCatalogState/current').get();
  if (!pointerSnapshot.exists) throw new Error('catalog current pointer is missing');
  const pointer = pointerSnapshot.data();
  assertCatalogManifest(pointer, 'catalog current pointer');

  const runPath = `franchiseCatalogRuns/${pointer.runId}`;
  const runSnapshot = await db.doc(runPath).get();
  if (!runSnapshot.exists) throw new Error('catalog referenced run is missing');
  const run = runSnapshot.data();
  assertCatalogManifest(run, 'catalog referenced run', { status: 'ready' });
  if (!sameCatalogManifest(pointer, run)) {
    throw new Error('catalog current pointer does not match ready run manifest');
  }

  const snapshot = await db.collection(`${runPath}/foods`)
    .where('searchTokens', 'array-contains', strongestToken)
    .limit(limit + 1)
    .get();
  if (!snapshot || !Array.isArray(snapshot.docs)) {
    throw new TypeError('catalog foods query returned an invalid snapshot');
  }

  const matched = [];
  for (const document of snapshot.docs) {
    if (!document || typeof document.data !== 'function') {
      throw new TypeError('catalog foods query returned an invalid document');
    }
    const record = validateCatalogRecord(document.data());
    if (record.active && tokens.every((token) => record.searchTokens.includes(token))) {
      matched.push(catalogRecordToSearchFood(record));
    }
  }

  return {
    items: matched.slice(0, limit),
    hasMore: matched.length > limit,
  };
}

function assertSearchItems(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  for (const item of value) {
    if (typeof item !== 'object' || item === null || typeof item.name !== 'string') {
      throw new TypeError(`${label} items must be objects with a string name`);
    }
  }
}

function itemSourceType(item) {
  return item.source?.type ?? 'public_data';
}

function sourcePriority(item) {
  if (itemSourceType(item) === 'official_brand') return 3;
  if (itemSourceType(item) === 'public_data') return 2;
  if (itemSourceType(item) === 'general_reference') return 1;
  return 0;
}

function itemServing(item) {
  if (
    item.serving
    && typeof item.serving.amount === 'number'
    && Number.isFinite(item.serving.amount)
    && typeof item.serving.unit === 'string'
  ) {
    return item.serving;
  }
  return { amount: 100, unit: item.basis ?? 'g' };
}

function canonicalBrandIdentity(value) {
  const normalized = normalizeCatalogText(value);
  return REVIEWED_BRAND_IDENTITIES.get(normalized) ?? normalized;
}

function itemIdentity(item) {
  const serving = itemServing(item);
  const brand = typeof item.maker === 'string' ? item.maker : '';
  return [
    canonicalBrandIdentity(brand),
    normalizeCatalogText(item.name),
    String(serving.amount),
    serving.unit,
  ].join('\u0000');
}

function itemKey(item) {
  if (typeof item.foodKey === 'string') return item.foodKey;
  if (typeof item.foodCode === 'string') return `mfds_${item.foodCode}`;
  return itemIdentity(item);
}

function relevanceScore(item, query) {
  const normalizedQuery = normalizeCatalogText(query);
  if (normalizedQuery === '') return 0;

  const normalizedName = normalizeCatalogText(item.name);
  const normalizedMaker = typeof item.maker === 'string' ? normalizeCatalogText(item.maker) : '';
  let score = 0;
  if (normalizedName === normalizedQuery) score += 100;
  if (normalizedName.startsWith(normalizedQuery)) score += 50;
  if (normalizedName.includes(normalizedQuery)) score += 25;

  for (const token of normalizedQuery.split(' ')) {
    if (normalizedName.includes(token)) score += 10;
    if (normalizedMaker.includes(token)) score += 15;
    if (CATALOG_SEARCH_TOKENS.get(item)?.includes(token)) score += 15;
  }
  return score;
}

function compareItems(left, right, query) {
  return (
    relevanceScore(right, query) - relevanceScore(left, query)
    || sourcePriority(right) - sourcePriority(left)
    || itemKey(left).localeCompare(itemKey(right), 'en')
  );
}

export function mergeCatalogAndMfdsResults(catalogItems, mfdsItems, query) {
  assertSearchItems(catalogItems, 'catalogItems');
  assertSearchItems(mfdsItems, 'mfdsItems');
  if (typeof query !== 'string') throw new TypeError('query must be a string');

  const byIdentity = new Map();
  for (const item of [...catalogItems, ...mfdsItems]) {
    const identity = itemIdentity(item);
    const current = byIdentity.get(identity);
    if (!current || compareItems(item, current, query) < 0) byIdentity.set(identity, item);
  }

  return [...byIdentity.values()].sort((left, right) => compareItems(left, right, query));
}
