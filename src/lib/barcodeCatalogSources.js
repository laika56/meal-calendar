import { createHash } from 'node:crypto';

import {
  canonicalCatalogBarcode,
  chooseBarcodeCandidate,
  normalizeBarcodeCatalogRecord,
} from './barcodeCatalog.js';
import { parseMfdsFoodItem, resolveServing } from './mfdsParser.js';

const FOOD_QR_CORE_NUTRIENTS = new Map([
  ['열량', ['kcal', 'kcal']],
  ['탄수화물', ['carbG', 'g']],
  ['단백질', ['proteinG', 'g']],
  ['지방', ['fatG', 'g']],
]);

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim().normalize('NFC');
}

function nullableText(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().normalize('NFC')
    : null;
}

function verifiedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new TypeError('verifiedAt must be a YYYY-MM-DD date');
  }
  return value;
}

function isExpired(value, at) {
  if (value === '99991231') return false;
  if (typeof value !== 'string' || !/^\d{8}$/u.test(value)) {
    throw new TypeError('valid end date must be YYYYMMDD or 99991231');
  }
  const normalized = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new TypeError('valid end date must be a real date');
  }
  return normalized < at;
}

function parseFoodQrQuantity(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)\s*(g|m[Ll]|kg|[Ll])(?:\s*\(\s*([\d,]+(?:\.\d+)?)\s*kcal\s*\))?$/u.exec(value.trim());
  if (!match) return null;
  const multiplier = match[2] === 'kg' || match[2] === 'L' || match[2] === 'l' ? 1000 : 1;
  const amount = Number(match[1]) * multiplier;
  const kcal = match[3] === undefined ? null : Number(match[3].replaceAll(',', ''));
  if (!Number.isFinite(amount) || amount <= 0
    || (kcal !== null && (!Number.isFinite(kcal) || kcal < 0))) return null;
  return {
    amount,
    unit: match[2] === 'g' || match[2] === 'kg' ? 'g' : 'mL',
    kcal,
  };
}

function finiteNonNegative(value, label) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/u.test(value.trim())) {
    throw new TypeError(`${label} must be a non-negative decimal string`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} must be finite and non-negative`);
  }
  return number;
}

export function parseFoodQrRow(row, nutrientRows, { verifiedAt } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('FoodQR label row must be an object');
  }
  if (!Array.isArray(nutrientRows)) {
    throw new TypeError('FoodQR nutrient rows must be an array');
  }
  const date = verifiedDate(verifiedAt);
  if (row.VLD_END_YMD === null || row.VLD_END_YMD === undefined || row.VLD_END_YMD === '') {
    return { exclusion: 'missing-valid-end' };
  }
  if (isExpired(row.VLD_END_YMD, date)) return { exclusion: 'expired' };
  const barcode = canonicalCatalogBarcode(row.BRCD_NO);
  if (barcode === null) return { exclusion: 'invalid-barcode' };
  const quantity = parseFoodQrQuantity(row.CTV);
  if (quantity === null) return { exclusion: 'unsupported-quantity' };
  const sourceId = requiredText(row.ELB_MNG_NO, 'FoodQR ELB_MNG_NO');
  const name = requiredText(row.PRDCT_NM, 'FoodQR PRDCT_NM');
  const amounts = { kcal: null, carbG: null, proteinG: null, fatG: null };
  let nutritionServing = null;
  let maker = null;

  for (const nutrient of nutrientRows) {
    if (!nutrient || typeof nutrient !== 'object' || Array.isArray(nutrient)) {
      throw new TypeError('FoodQR nutrient row must be an object');
    }
    if (nutrient.ELB_MNG_NO !== row.ELB_MNG_NO || nutrient.BRCD_NO !== row.BRCD_NO) {
      throw new Error('FoodQR nutrient identity mismatch');
    }
    if (nutrient.VLD_END_YMD !== null && nutrient.VLD_END_YMD !== undefined
      && nutrient.VLD_END_YMD !== '' && isExpired(nutrient.VLD_END_YMD, date)) {
      throw new Error('FoodQR active label references an expired nutrient row');
    }
    const definition = FOOD_QR_CORE_NUTRIENTS.get(nullableText(nutrient.NIRWMT_NM));
    if (!definition) continue;
    const [field, expectedUnit] = definition;
    if (nutrient.IGRD_UCD !== expectedUnit) {
      throw new Error(`FoodQR ${nutrient.NIRWMT_NM} unit must be ${expectedUnit}`);
    }
    const amount = finiteNonNegative(nutrient.CTA, `FoodQR ${nutrient.NIRWMT_NM}`);
    if (amounts[field] !== null && amounts[field] !== amount) {
      throw new Error(`FoodQR duplicate ${nutrient.NIRWMT_NM} conflict`);
    }
    amounts[field] = amount;
    const declaredServing = finiteNonNegative(
      nutrient.NTRTN_ICUT_CTV ?? '0',
      'FoodQR nutrition serving',
    );
    if (declaredServing > 0) {
      const unit = nutrient.NTRTN_ICUT_CVUCD === 'g'
        ? 'g'
        : (String(nutrient.NTRTN_ICUT_CVUCD).toLowerCase() === 'ml' ? 'mL' : null);
      if (unit === null) throw new Error('FoodQR nutrition serving unit must be g or mL');
      const current = { amount: declaredServing, unit };
      if (nutritionServing !== null
        && (nutritionServing.amount !== current.amount || nutritionServing.unit !== current.unit)) {
        throw new Error('FoodQR nutrition serving conflict');
      }
      nutritionServing = current;
    }
    const currentMaker = nullableText(nutrient.BUES_NM);
    if (maker !== null && currentMaker !== null && maker !== currentMaker) {
      throw new Error('FoodQR nutrient maker conflict');
    }
    maker ??= currentMaker;
  }
  if (amounts.kcal === null) return { exclusion: 'missing-kcal' };
  let basis = nutritionServing;
  if (basis === null) {
    if (quantity.kcal === null || amounts.kcal === null || amounts.kcal <= 0) {
      return { exclusion: 'missing-nutrition-basis' };
    }
    basis = {
      amount: (amounts.kcal * quantity.amount) / quantity.kcal,
      unit: quantity.unit,
    };
  }
  if (basis.unit !== quantity.unit) {
    return { exclusion: 'unit-conflict' };
  }
  const values = Object.fromEntries(Object.entries(amounts).map(([field, amount]) => [
    field,
    amount === null ? null : (amount / basis.amount) * 100,
  ]));
  return {
    candidate: normalizeBarcodeCatalogRecord({
      barcode,
      name,
      maker,
      category: nullableText(row.FOOD_TYPE_CD_NM),
      serving: nutritionServing === null
        ? null
        : { amount: basis.amount, unit: basis.unit, source: 'official-serving' },
      per100g: values,
      source: {
        type: 'foodqr',
        sourceId,
        url: requiredText(row.QR_URL_ADDR, 'FoodQR QR_URL_ADDR'),
        verifiedAt: date,
      },
    }),
  };
}

export function parseTraceRow(row, nutritionIndex, { verifiedAt } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('trace row must be an object');
  }
  if (!(nutritionIndex instanceof Map)) {
    throw new TypeError('nutritionIndex must be a Map');
  }
  const date = verifiedDate(verifiedAt);
  if (row.USE_FLAG !== '1' || ![null, undefined, '', '0'].includes(row.CANCEL_TARGET_AT)) {
    return { exclusion: 'inactive' };
  }
  const barcode = canonicalCatalogBarcode(row.PDT_BARCD);
  if (barcode === null) return { exclusion: 'invalid-barcode' };
  const reportNumber = requiredText(row.PRDLST_REPORT_NO, 'trace PRDLST_REPORT_NO');
  const nutrition = nutritionIndex.get(reportNumber);
  if (nutrition === undefined) return { exclusion: 'missing-nutrition-join' };
  if (!nutrition || typeof nutrition !== 'object' || Array.isArray(nutrition)) {
    throw new TypeError('nutritionIndex value must be an object');
  }

  return {
    candidate: normalizeBarcodeCatalogRecord({
      barcode,
      name: requiredText(row.PDT_NM, 'trace PDT_NM'),
      maker: nullableText(row.BRNCH_NM),
      category: nullableText(row.PDT_TYP_CD),
      serving: nutrition.serving,
      per100g: nutrition.per100g,
      source: {
        type: 'mfds-joined',
        sourceId: requiredText(nutrition.sourceId, 'nutrition sourceId'),
        url: requiredText(nutrition.url, 'nutrition url'),
        verifiedAt: date,
      },
    }),
  };
}

export function buildBarcodeCatalog(results) {
  if (!Array.isArray(results)) throw new TypeError('buildBarcodeCatalog: results must be an array');
  const candidates = new Map();
  const exclusionCounts = new Map();
  for (const result of results) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new TypeError('buildBarcodeCatalog: result must be an object');
    }
    if (Object.hasOwn(result, 'exclusion')) {
      const reason = requiredText(result.exclusion, 'exclusion');
      exclusionCounts.set(reason, (exclusionCounts.get(reason) ?? 0) + 1);
      continue;
    }
    if (!Object.hasOwn(result, 'candidate')) {
      throw new TypeError('buildBarcodeCatalog: result must contain candidate or exclusion');
    }
    const candidate = normalizeBarcodeCatalogRecord(result.candidate);
    const group = candidates.get(candidate.barcode) ?? [];
    group.push(candidate);
    candidates.set(candidate.barcode, group);
  }
  const records = [];
  for (const group of candidates.values()) {
    try {
      records.push(chooseBarcodeCandidate(group));
    } catch (error) {
      if (error instanceof Error && /^conflicting .+ candidates for \d+$/u.test(error.message)) {
        exclusionCounts.set(
          'ambiguous-barcode',
          (exclusionCounts.get('ambiguous-barcode') ?? 0) + group.length,
        );
        continue;
      }
      throw error;
    }
  }
  records.sort((left, right) => left.barcode.localeCompare(right.barcode));
  const bytes = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  return {
    records,
    manifest: {
      schemaVersion: 1,
      recordCount: records.length,
      materialSha256: createHash('sha256').update(bytes, 'utf8').digest('hex'),
    },
    exclusionCounts: Object.fromEntries(
      [...exclusionCounts].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function buildFoodQrCatalog(labelRows, nutrientRows, options) {
  if (!Array.isArray(labelRows) || !Array.isArray(nutrientRows)) {
    throw new TypeError('buildFoodQrCatalog: rows must be arrays');
  }
  const listRows = options?.listRows;
  if (listRows !== undefined && !Array.isArray(listRows)) {
    throw new TypeError('buildFoodQrCatalog: listRows must be an array');
  }
  const listLanguage = new Map();
  for (const row of listRows ?? []) {
    const key = `${requiredText(row?.BRCD_NO, 'FoodQR list BRCD_NO')}\0${requiredText(row?.PRDT_NM, 'FoodQR list PRDT_NM')}`;
    const language = requiredText(row?.LANG_CD, 'FoodQR list LANG_CD');
    const languages = listLanguage.get(key) ?? new Set();
    languages.add(language);
    listLanguage.set(key, languages);
  }
  const parseOptions = { verifiedAt: options?.verifiedAt };
  const nutrientsByIdentity = new Map();
  for (const row of nutrientRows) {
    const identity = requiredText(row?.ELB_MNG_NO, 'FoodQR nutrient ELB_MNG_NO');
    const values = nutrientsByIdentity.get(identity) ?? [];
    values.push(row);
    nutrientsByIdentity.set(identity, values);
  }
  const labelIdentities = new Set();
  const results = labelRows.map((row) => {
    const identity = requiredText(row?.ELB_MNG_NO, 'FoodQR label ELB_MNG_NO');
    if (labelIdentities.has(identity)) throw new Error(`duplicate FoodQR label identity ${identity}`);
    labelIdentities.add(identity);
    if (listRows !== undefined) {
      const key = `${requiredText(row.BRCD_NO, 'FoodQR label BRCD_NO')}\0${requiredText(row.PRDCT_NM, 'FoodQR label PRDCT_NM')}`;
      const languages = listLanguage.get(key);
      if (languages === undefined) return { exclusion: 'missing-list-identity' };
      if (!languages.has('001')) return { exclusion: 'non-korean-language' };
    }
    try {
      return parseFoodQrRow(row, nutrientsByIdentity.get(identity) ?? [], parseOptions);
    } catch (error) {
      if (error instanceof Error && /^FoodQR (duplicate|nutrient maker conflict|nutrition serving conflict)/u.test(error.message)) {
        return { exclusion: 'nutrient-conflict' };
      }
      if (error instanceof TypeError && /^FoodQR .+ must be/u.test(error.message)) {
        return { exclusion: 'invalid-nutrient-value' };
      }
      throw error;
    }
  });
  const catalog = buildBarcodeCatalog(results);
  return {
    ...catalog,
    sourceCounts: {
      labels: labelRows.length,
      nutrients: nutrientRows.length,
      orphanNutrients: nutrientRows.filter((row) => !labelIdentities.has(row.ELB_MNG_NO)).length,
      ...(listRows === undefined ? {} : { list: listRows.length }),
    },
  };
}

export function indexMfdsNutritionRows(nutritionIndex, conflictedReports, nutritionRows) {
  if (!(nutritionIndex instanceof Map) || !(conflictedReports instanceof Set)
    || !Array.isArray(nutritionRows)) {
    throw new TypeError('indexMfdsNutritionRows: expected Map, Set, and rows array');
  }
  for (const row of nutritionRows) {
    const reportNumber = nullableText(row?.ITEM_REPORT_NO);
    if (reportNumber === null) continue;
    let parsed;
    try {
      const food = parseMfdsFoodItem(row);
      const resolved = resolveServing(food);
      parsed = {
        serving: resolved === null ? null : {
          amount: resolved.amount, unit: resolved.unit, source: 'official-serving',
        },
        per100g: food.per100g,
        sourceId: requiredText(row.FOOD_CD, 'MFDS FOOD_CD'),
        url: 'https://www.data.go.kr/data/15127578/openapi.do',
      };
    } catch {
      conflictedReports.add(reportNumber);
      nutritionIndex.delete(reportNumber);
      continue;
    }
    const previous = nutritionIndex.get(reportNumber);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(parsed)) {
      conflictedReports.add(reportNumber);
      nutritionIndex.delete(reportNumber);
      continue;
    }
    if (!conflictedReports.has(reportNumber)) nutritionIndex.set(reportNumber, parsed);
  }
  return { nutritionIndex, conflictedReports };
}

export function buildTraceCatalog(traceRows, nutritionRows, {
  verifiedAt, conflictedReports: suppliedConflicts, nutritionCount,
} = {}) {
  if (!Array.isArray(traceRows) || (!Array.isArray(nutritionRows) && !(nutritionRows instanceof Map))) {
    throw new TypeError('buildTraceCatalog: trace rows and nutrition rows/index are required');
  }
  const date = verifiedDate(verifiedAt);
  const nutritionIndex = nutritionRows instanceof Map ? nutritionRows : new Map();
  const conflictedReports = nutritionRows instanceof Map
    ? suppliedConflicts
    : new Set();
  if (!(conflictedReports instanceof Set)) {
    throw new TypeError('buildTraceCatalog: conflictedReports must be a Set for a nutrition index');
  }
  if (Array.isArray(nutritionRows)) {
    indexMfdsNutritionRows(nutritionIndex, conflictedReports, nutritionRows);
  }
  const results = traceRows.map((row) => {
    const reportNumber = nullableText(row?.PRDLST_REPORT_NO);
    if (reportNumber !== null && conflictedReports.has(reportNumber)) {
      return { exclusion: 'nutrition-join-conflict' };
    }
    try {
      return parseTraceRow(row, nutritionIndex, { verifiedAt: date });
    } catch (error) {
      if (error instanceof TypeError) return { exclusion: 'invalid-trace-row' };
      throw error;
    }
  });
  return {
    ...buildBarcodeCatalog(results),
    sourceCounts: {
      trace: traceRows.length,
      nutrition: nutritionRows instanceof Map ? nutritionCount : nutritionRows.length,
    },
  };
}
