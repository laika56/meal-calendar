import { createHash } from 'node:crypto';

const RECORD_KEYS = new Set([
  'barcode', 'name', 'maker', 'category', 'serving', 'per100g', 'source',
]);
const SERVING_KEYS = new Set(['amount', 'unit', 'source']);
const NUTRIENT_KEYS = new Set(['kcal', 'carbG', 'proteinG', 'fatG']);
const SOURCE_KEYS = new Set(['type', 'sourceId', 'url', 'verifiedAt']);
const SOURCE_TYPES = new Set(['mfds', 'foodqr', 'mfds-joined', 'off', 'usda']);
const SOURCE_RANK = new Map([
  ['mfds', 0],
  ['foodqr', 1],
  ['mfds-joined', 2],
  ['off', 3],
  ['usda', 4],
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertClosedShape(value, keys, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${label} has unexpected key ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing required key ${key}`);
  }
}

function checkDigit(body) {
  let sum = 0;
  for (let index = body.length - 1, offset = 0; index >= 0; index -= 1, offset += 1) {
    sum += Number(body[index]) * (offset % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

export function canonicalCatalogBarcode(value) {
  if (typeof value !== 'string' || !/^\d{8}$|^\d{12,14}$/u.test(value)) return null;
  const body = value.slice(0, -1);
  if (checkDigit(body) !== value.at(-1)) return null;
  if (value.length === 12) return `0${value}`;
  if (value.length === 14 && value.startsWith('0')) return value.slice(1);
  return value;
}

function normalizeNullableText(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be null or a non-empty string`);
  }
  return value.trim().normalize('NFC');
}

function normalizeRequiredText(value, label) {
  const normalized = normalizeNullableText(value, label);
  if (normalized === null) throw new TypeError(`${label} must be a non-empty string`);
  return normalized;
}

function normalizeServing(value) {
  if (value === null) return null;
  assertClosedShape(value, SERVING_KEYS, 'serving');
  if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0) {
    throw new TypeError('serving.amount must be a finite positive number');
  }
  if (value.unit !== 'g' && value.unit !== 'mL') {
    throw new TypeError('serving.unit must be g or mL');
  }
  if (value.source !== 'official-serving') {
    throw new TypeError('serving.source must be official-serving');
  }
  return { amount: value.amount, unit: value.unit, source: value.source };
}

function normalizeNutrients(value) {
  assertClosedShape(value, NUTRIENT_KEYS, 'per100g');
  const normalized = {};
  for (const key of NUTRIENT_KEYS) {
    const nutrient = value[key];
    if (
      nutrient !== null
      && (typeof nutrient !== 'number' || !Number.isFinite(nutrient) || nutrient < 0)
    ) {
      throw new TypeError(`per100g.${key} must be null or a finite non-negative number`);
    }
    normalized[key] = nutrient;
  }
  return normalized;
}

function normalizeSource(value) {
  assertClosedShape(value, SOURCE_KEYS, 'source');
  if (!SOURCE_TYPES.has(value.type)) {
    throw new TypeError(`source.type must be one of ${[...SOURCE_TYPES].join(', ')}`);
  }
  const sourceId = normalizeRequiredText(value.sourceId, 'source.sourceId');
  let url;
  try {
    url = new URL(value.url);
  } catch {
    throw new TypeError('source.url must be an absolute http or https URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('source.url must be an absolute http or https URL');
  }
  if (
    typeof value.verifiedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value.verifiedAt)
    || Number.isNaN(Date.parse(`${value.verifiedAt}T00:00:00Z`))
  ) {
    throw new TypeError('source.verifiedAt must be a YYYY-MM-DD date');
  }
  return { type: value.type, sourceId, url: url.href, verifiedAt: value.verifiedAt };
}

export function normalizeBarcodeCatalogRecord(value) {
  assertClosedShape(value, RECORD_KEYS, 'catalog record');
  const barcode = canonicalCatalogBarcode(value.barcode);
  if (barcode === null) throw new TypeError('catalog record barcode must be a valid GTIN');
  return {
    barcode,
    name: normalizeRequiredText(value.name, 'name'),
    maker: normalizeNullableText(value.maker, 'maker'),
    category: normalizeNullableText(value.category, 'category'),
    serving: normalizeServing(value.serving),
    per100g: normalizeNutrients(value.per100g),
    source: normalizeSource(value.source),
  };
}

function candidateIdentity(record) {
  return JSON.stringify({
    barcode: record.barcode,
    name: record.name,
    maker: record.maker,
    category: record.category,
    serving: record.serving,
    per100g: record.per100g,
    sourceType: record.source.type,
  });
}

export function chooseBarcodeCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError('chooseBarcodeCandidate: candidates must be a non-empty array');
  }
  const normalized = candidates.map(normalizeBarcodeCatalogRecord);
  const barcode = normalized[0].barcode;
  if (normalized.some((candidate) => candidate.barcode !== barcode)) {
    throw new Error('chooseBarcodeCandidate: all candidates must have the same barcode');
  }
  normalized.sort((a, b) => {
    const rank = SOURCE_RANK.get(a.source.type) - SOURCE_RANK.get(b.source.type);
    return rank || a.source.sourceId.localeCompare(b.source.sourceId);
  });
  const bestRank = SOURCE_RANK.get(normalized[0].source.type);
  const best = normalized.filter((candidate) => SOURCE_RANK.get(candidate.source.type) === bestRank);
  const identity = candidateIdentity(best[0]);
  if (best.some((candidate) => candidateIdentity(candidate) !== identity)) {
    throw new Error(`conflicting ${best[0].source.type} candidates for ${barcode}`);
  }
  return best[0];
}

function materialBytes(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

export function validateBarcodeCatalog(records, manifest) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  assertClosedShape(
    manifest,
    new Set(['schemaVersion', 'recordCount', 'materialSha256']),
    'manifest',
  );
  if (manifest.schemaVersion !== 1) throw new TypeError('manifest.schemaVersion must be 1');
  if (!Number.isSafeInteger(manifest.recordCount) || manifest.recordCount < 0) {
    throw new TypeError('manifest.recordCount must be a non-negative safe integer');
  }
  if (!/^[a-f0-9]{64}$/u.test(manifest.materialSha256)) {
    throw new TypeError('manifest.materialSha256 must be a lowercase SHA-256 hex string');
  }

  let previous = null;
  const normalized = records.map((record) => normalizeBarcodeCatalogRecord(record));
  for (let index = 0; index < normalized.length; index += 1) {
    if (JSON.stringify(normalized[index]) !== JSON.stringify(records[index])) {
      throw new Error(`record ${index} is not canonical`);
    }
    const barcode = normalized[index].barcode;
    if (barcode === previous) throw new Error(`duplicate barcode ${barcode}`);
    if (previous !== null && previous.localeCompare(barcode) > 0) {
      throw new Error('records must be sorted by barcode');
    }
    previous = barcode;
  }
  if (manifest.recordCount !== normalized.length) {
    throw new Error(`manifest recordCount ${manifest.recordCount} does not match ${normalized.length}`);
  }
  const materialSha256 = createHash('sha256').update(materialBytes(normalized)).digest('hex');
  if (manifest.materialSha256 !== materialSha256) {
    throw new Error('manifest materialSha256 does not match catalog records');
  }
  return { records, manifest };
}
