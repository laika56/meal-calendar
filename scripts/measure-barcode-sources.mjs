import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`measureSource: ${label} must be a positive integer`);
  }
}

function isMissing(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function assertPage(sourceId, page, expectedPageNo, expectedTotalCount, expectedRows) {
  if (!page || typeof page !== 'object') {
    throw new TypeError(`${sourceId}: page ${expectedPageNo} must be an object`);
  }
  if (page.pageNo !== expectedPageNo) {
    throw new Error(`${sourceId}: expected page ${expectedPageNo}, received ${page.pageNo}`);
  }
  if (page.totalCount !== expectedTotalCount) {
    throw new Error(
      `${sourceId}: total count changed from ${expectedTotalCount} to ${page.totalCount}`,
    );
  }
  if (!Array.isArray(page.rows)) {
    throw new TypeError(`${sourceId}: page ${expectedPageNo} rows must be an array`);
  }
  if (page.rows.length !== expectedRows) {
    throw new Error(
      `${sourceId}: page ${expectedPageNo} expected ${expectedRows} rows, received ${page.rows.length}`,
    );
  }
}

export function normalizeDataGoPage(payload, sourceId) {
  const response = payload?.response ?? payload;
  const header = response?.header;
  const code = String(header?.resultCode ?? 'missing');
  const message = String(header?.resultMsg ?? 'missing result message');
  if (code !== '00') {
    throw new Error(`${sourceId}: data.go.kr returned ${code} ${message}`);
  }
  const body = response?.body;
  const pageNo = Number(body?.pageNo);
  const totalCount = Number(body?.totalCount);
  if (!Number.isSafeInteger(pageNo) || pageNo <= 0) {
    throw new TypeError(`${sourceId}: data.go.kr pageNo must be a positive integer`);
  }
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new TypeError(`${sourceId}: data.go.kr totalCount must be a non-negative integer`);
  }
  const item = Array.isArray(body?.items) ? body.items : body?.items?.item;
  let rows;
  if (item === undefined || item === null) rows = [];
  else if (Array.isArray(item)) rows = item;
  else if (typeof item === 'object') rows = [item];
  else throw new TypeError(`${sourceId}: data.go.kr items.item must be an object or array`);
  return { pageNo, totalCount, rows };
}

export function buildDataGoUrl({ baseUrl, serviceKey, pageNo, pageSize }) {
  if (typeof serviceKey !== 'string' || !serviceKey) {
    throw new TypeError('buildDataGoUrl: serviceKey must be a non-empty string');
  }
  const url = new URL(baseUrl);
  url.searchParams.set('serviceKey', decodeURIComponent(serviceKey));
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(pageSize));
  url.searchParams.set('type', 'json');
  return url;
}

export function parseMeasurementArgs(argv) {
  const parsed = {
    sourceIds: ['trace', 'foodqr-list', 'foodqr-label', 'foodqr-nutrients'],
    pageSize: 500,
    writeProfile: null,
  };
  let choseSource = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === '--source') {
      if (!Object.hasOwn(SOURCE_CONFIGS, value)) throw new TypeError(`unknown source ${value}`);
      if (!choseSource) parsed.sourceIds = [];
      parsed.sourceIds.push(value);
      choseSource = true;
      index += 1;
    } else if (option === '--page-size') {
      const pageSize = Number(value);
      assertPositiveInteger(pageSize, 'pageSize');
      parsed.pageSize = pageSize;
      index += 1;
    } else if (option === '--write-profile') {
      if (typeof value !== 'string' || !value) {
        throw new TypeError('--write-profile requires a path');
      }
      parsed.writeProfile = value;
      index += 1;
    } else {
      throw new TypeError(`unknown option ${option}`);
    }
  }
  return parsed;
}

async function loadDataGoKey() {
  if (typeof process.env.MFDS_API_KEY === 'string' && process.env.MFDS_API_KEY) {
    return process.env.MFDS_API_KEY;
  }
  const dotenv = await readFile(path.resolve('.env'), 'utf8');
  const line = dotenv.split(/\r?\n/u).find((entry) => entry.startsWith('MFDS_API_KEY='));
  if (!line || !line.slice('MFDS_API_KEY='.length).trim()) {
    throw new Error('MFDS_API_KEY is required in the environment or .env');
  }
  return line.slice('MFDS_API_KEY='.length).trim();
}

async function fetchDataGoPage({ sourceId, config, serviceKey, pageNo, pageSize }) {
  const url = buildDataGoUrl({
    baseUrl: config.baseUrl,
    serviceKey,
    pageNo,
    pageSize,
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`${sourceId}: HTTP ${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${sourceId}: response was not JSON`);
  }
  return normalizeDataGoPage(payload, sourceId);
}

async function main() {
  const options = parseMeasurementArgs(process.argv.slice(2));
  const serviceKey = await loadDataGoKey();
  const profiles = [];
  for (const sourceId of options.sourceIds) {
    const config = SOURCE_CONFIGS[sourceId];
    let observedPages = 0;
    const profile = await measureSource({
      sourceId,
      pageSize: options.pageSize,
      projectRow: config.projectRow,
      async fetchPage(pageNo) {
        const page = await fetchDataGoPage({
          sourceId,
          config,
          serviceKey,
          pageNo,
          pageSize: options.pageSize,
        });
        observedPages += 1;
        if (observedPages === 1 || observedPages % 25 === 0 || page.rows.length < options.pageSize) {
          const totalPages = Math.max(1, Math.ceil(page.totalCount / options.pageSize));
          process.stderr.write(`${sourceId}: page ${pageNo}/${totalPages}, rows ${Math.min(pageNo * options.pageSize, page.totalCount)}/${page.totalCount}\n`);
        }
        return page;
      },
    });
    profiles.push(profile);
  }
  const output = { schemaVersion: 1, profiles };
  if (options.writeProfile !== null) {
    await writeFile(options.writeProfile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

export async function measureSource({ sourceId, fetchPage, pageSize, projectRow }) {
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    throw new TypeError('measureSource: sourceId must be a non-empty string');
  }
  if (typeof fetchPage !== 'function' || typeof projectRow !== 'function') {
    throw new TypeError('measureSource: fetchPage and projectRow must be functions');
  }
  assertPositiveInteger(pageSize, 'pageSize');

  const first = await fetchPage(1);
  if (!first || !Number.isInteger(first.totalCount) || first.totalCount < 0) {
    throw new TypeError(`${sourceId}: totalCount must be a non-negative integer`);
  }

  const totalCount = first.totalCount;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const fieldPresence = new Map();
  const barcodeLengths = new Map();
  const dimensionValues = new Map();
  const missing = {
    barcode: 0,
    name: 0,
    maker: 0,
    serving: 0,
    kcal: 0,
    carbG: 0,
    proteinG: 0,
    fatG: 0,
  };
  let totalRows = 0;

  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    const page = pageNo === 1 ? first : await fetchPage(pageNo);
    const remaining = totalCount - ((pageNo - 1) * pageSize);
    const expectedRows = Math.min(pageSize, Math.max(remaining, 0));
    assertPage(sourceId, page, pageNo, totalCount, expectedRows);

    for (const raw of page.rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError(`${sourceId}: page ${pageNo} contains a non-object row`);
      }
      totalRows += 1;
      for (const key of Object.keys(raw)) {
        fieldPresence.set(key, (fieldPresence.get(key) ?? 0) + 1);
      }
      const projected = projectRow(raw);
      if (!projected || typeof projected !== 'object' || Array.isArray(projected)) {
        throw new TypeError(`${sourceId}: projectRow must return an object`);
      }
      for (const key of Object.keys(missing)) {
        if (isMissing(projected[key])) missing[key] += 1;
      }
      if (typeof projected.barcode === 'string') {
        const barcode = projected.barcode.trim();
        if (/^\d+$/.test(barcode)) {
          barcodeLengths.set(barcode.length, (barcodeLengths.get(barcode.length) ?? 0) + 1);
        }
      }
      if (projected.dimensions !== undefined) {
        if (!projected.dimensions || typeof projected.dimensions !== 'object'
          || Array.isArray(projected.dimensions)) {
          throw new TypeError(`${sourceId}: projected dimensions must be an object`);
        }
        for (const [dimension, rawValue] of Object.entries(projected.dimensions)) {
          const value = isMissing(rawValue) ? '<missing>' : String(rawValue).trim();
          if (!dimension || value.length > 100) {
            throw new TypeError(`${sourceId}: invalid projected dimension value`);
          }
          const values = dimensionValues.get(dimension) ?? new Map();
          values.set(value, (values.get(value) ?? 0) + 1);
          dimensionValues.set(dimension, values);
        }
      }
    }
  }

  if (totalRows !== totalCount) {
    throw new Error(`${sourceId}: expected ${totalCount} rows, received ${totalRows}`);
  }

  return {
    sourceId: sourceId.trim(),
    totalRows,
    pageCount,
    fieldPresence: Object.fromEntries([...fieldPresence].sort(([a], [b]) => a.localeCompare(b))),
    barcodeLengths: Object.fromEntries([...barcodeLengths].sort(([a], [b]) => a - b)),
    dimensionValues: Object.fromEntries(
      [...dimensionValues]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dimension, values]) => [
          dimension,
          Object.fromEntries([...values].sort(([a], [b]) => a.localeCompare(b))),
        ]),
    ),
    missing,
  };
}

const SOURCE_CONFIGS = {
  trace: {
    baseUrl: 'https://apis.data.go.kr/1471000/FoodHistTrckMngPrdlstRegInfo/getFoodHistTrckMngPrdlstRegInfo',
    projectRow: (row) => ({
      barcode: row.PDT_BARCD,
      name: row.PDT_NM,
      maker: row.BRNCH_NM,
      serving: null,
      kcal: null,
      carbG: null,
      proteinG: null,
      fatG: null,
      dimensions: {
        useFlag: row.USE_FLAG,
        cancelTarget: row.CANCEL_TARGET_AT,
        foodType: row.PDT_TYP_CD,
      },
    }),
  },
  'foodqr-list': {
    baseUrl: 'https://apis.data.go.kr/1471000/FoodQrInfoService01/getFoodQrProdList01',
    projectRow: (row) => ({
      barcode: row.BRCD_NO,
      name: row.PRDT_NM,
      maker: row.ENTP_NM,
      serving: null,
      kcal: null,
      carbG: null,
      proteinG: null,
      fatG: null,
      dimensions: {
        languageCode: row.LANG_CD,
        validEnd: row.VLD_END_YMD,
      },
    }),
  },
  'foodqr-label': {
    baseUrl: 'https://apis.data.go.kr/1471000/FoodQrInfoService01/getFoodQrIndctInfo01',
    projectRow: (row) => ({
      barcode: row.BRCD_NO,
      name: row.PRDCT_NM,
      maker: null,
      serving: row.CTV,
      kcal: row.CTV,
      carbG: null,
      proteinG: null,
      fatG: null,
      dimensions: {
        foodType: row.FOOD_TYPE_CD_NM,
        quantity: row.CTV,
        validEnd: row.VLD_END_YMD,
      },
    }),
  },
  'foodqr-nutrients': {
    baseUrl: 'https://apis.data.go.kr/1471000/FoodQrInfoService01/getFoodQrProdNsd01',
    projectRow: (row) => {
      const nutrientName = typeof row.NIRWMT_NM === 'string' ? row.NIRWMT_NM.trim() : '';
      return {
        barcode: row.BRCD_NO,
        name: row.PRDCT_NM,
        maker: row.BUES_NM,
        serving: row.NTRTN_ICUT_CTV,
        kcal: nutrientName === '열량' ? row.CTA : null,
        carbG: nutrientName === '탄수화물' ? row.CTA : null,
        proteinG: nutrientName === '단백질' ? row.CTA : null,
        fatG: nutrientName === '지방' ? row.CTA : null,
        dimensions: {
          nutrientName: row.NIRWMT_NM,
          nutrientUnit: row.NTRTN_ICUT_CVUCD,
          servingUnit: row.IGRD_UCD,
          validEnd: row.VLD_END_YMD,
        },
      };
    },
  },
};

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
