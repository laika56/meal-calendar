#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMfdsFoodItem } from '../src/lib/mfdsParser.js';
import { normalizeCatalogText } from '../src/lib/franchiseCatalog.js';

const MFDS_ENDPOINT = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02';
const ROWS_PER_PAGE = 500;
const REQUEST_TIMEOUT_MS = 8_000;
const FETCH_CONCURRENCY = 4;
const SOURCE_ID = 'mfds-franchise';
const SOURCE_URL = MFDS_ENDPOINT;
const SNAPSHOT_RELATIVE_PATH = 'data/franchise/public/mfds-franchise.json';
const LICENSE_EVIDENCE_URL = 'https://www.data.go.kr/data/15127578/openapi.do?recommendDataYn=Y';

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertIsoUtcDate(value, label) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${label} must be an ISO UTC date`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function publicBrandIdForMaker(maker) {
  assertNonEmptyString(maker, 'makerName');
  return `mfds-brand-${createHash('sha256').update(normalizeCatalogText(maker), 'utf8').digest('hex').slice(0, 16)}`;
}

function searchTokens(...values) {
  return [...new Set(values
    .flatMap((value) => normalizeCatalogText(value).split(' '))
    .filter(Boolean))]
    .toSorted((left, right) => left.localeCompare(right, 'en'));
}

function assertRawIdentity(rawItem, parsed) {
  assertNonEmptyString(rawItem?.FOOD_CD, 'FOOD_CD');
  assertNonEmptyString(parsed.name, 'FOOD_NM_KR');
  assertNonEmptyString(parsed.category, 'FOOD_CAT1_NM');
  assertNonEmptyString(parsed.maker, 'MAKER_NM');
}

/** Returns 1-indexed MFDS page numbers required to cover totalCount records. */
export function buildMfdsPages(totalCount, rowsPerPage) {
  assertNonNegativeInteger(totalCount, 'totalCount');
  if (!Number.isSafeInteger(rowsPerPage) || rowsPerPage <= 0) {
    throw new TypeError('rowsPerPage must be a positive safe integer');
  }
  return Array.from({ length: Math.ceil(totalCount / rowsPerPage) }, (_, index) => index + 1);
}

export function shouldReportMfdsProgress(pageNo, totalPages) {
  if (!Number.isSafeInteger(pageNo) || !Number.isSafeInteger(totalPages) || pageNo < 1 || totalPages < pageNo) {
    throw new TypeError('page progress must use positive ordered safe integers');
  }
  return pageNo === 1 || pageNo === totalPages || pageNo % 25 === 0;
}

/** Converts one reviewed MFDS raw item to the public catalog contract, or null when it is not franchise-origin data. */
export function toPublicCatalogRecord(rawItem, generatedAt) {
  assertIsoUtcDate(generatedAt, 'generatedAt');
  if (rawItem?.FOOD_OR_CD !== '2') return null;

  const parsed = parseMfdsFoodItem(rawItem);
  assertRawIdentity(rawItem, parsed);
  const normalizedName = normalizeCatalogText(parsed.name);
  const normalizedMaker = normalizeCatalogText(parsed.maker);

  return {
    id: `mfds-${rawItem.FOOD_CD}`,
    brandId: publicBrandIdForMaker(parsed.maker),
    brandName: parsed.maker,
    name: parsed.name,
    aliases: [],
    normalizedName,
    searchTokens: searchTokens(normalizedMaker, normalizedName),
    category: parsed.category,
    basis: {
      amount: 100,
      unit: parsed.basis,
      label: parsed.basis === 'g' ? '100g' : '100mL',
    },
    nutrients: {
      kcal: parsed.per100g.kcal,
      carbG: parsed.per100g.carbG,
      proteinG: parsed.per100g.proteinG,
      fatG: parsed.per100g.fatG,
      sugarG: null,
      sodiumMg: null,
    },
    sourceId: SOURCE_ID,
    sourceType: 'public_data',
    sourceUrl: SOURCE_URL,
    sourceUpdatedAt: null,
    verifiedAt: generatedAt,
    confidence: 'public',
    active: true,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

/** Resolves MFDS makers against reviewed brands and creates separate public-only brands where necessary. */
export function reconcilePublicBrands(records, existingBrands, generatedAt) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!Array.isArray(existingBrands)) throw new TypeError('existingBrands must be an array');
  assertIsoUtcDate(generatedAt, 'generatedAt');

  const brandByNormalizedMaker = new Map();
  for (const brand of existingBrands) {
    assertNonEmptyString(brand?.id, 'brand.id');
    assertNonEmptyString(brand?.name, 'brand.name');
    for (const name of [brand.name, ...(brand.aliases ?? [])]) {
      const normalized = normalizeCatalogText(name);
      const current = brandByNormalizedMaker.get(normalized);
      if (current && current.id !== brand.id) {
        throw new Error(`ambiguous reviewed brand identity ${normalized}`);
      }
      brandByNormalizedMaker.set(normalized, brand);
    }
  }

  const generatedBrands = new Map();
  const resolvedRecords = records.map((record) => {
    assertNonEmptyString(record?.brandName, 'record.brandName');
    const normalizedMaker = normalizeCatalogText(record.brandName);
    let brand = brandByNormalizedMaker.get(normalizedMaker);
    if (!brand) {
      brand = generatedBrands.get(normalizedMaker);
      if (!brand) {
        brand = {
          id: publicBrandIdForMaker(record.brandName),
          name: record.brandName.trim(),
          normalizedName: normalizedMaker,
          aliases: [],
          category: 'MFDS 프랜차이즈',
          officialUrl: null,
          active: true,
          createdAt: generatedAt,
          updatedAt: generatedAt,
        };
        generatedBrands.set(normalizedMaker, brand);
        brandByNormalizedMaker.set(normalizedMaker, brand);
      }
    }
    return { ...record, brandId: brand.id, brandName: brand.name };
  });

  return {
    records: resolvedRecords,
    brands: [...existingBrands.map((brand) => structuredClone(brand)), ...generatedBrands.values()]
      .toSorted((left, right) => left.id.localeCompare(right.id, 'en')),
  };
}

/** Sorts an MFDS public snapshot and refuses duplicate record identities. */
export function canonicalSnapshot(records, metadata) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new TypeError('metadata must be an object');
  }
  const { generatedAt, sourceId, sourceManifestSha256 } = metadata;
  assertIsoUtcDate(generatedAt, 'metadata.generatedAt');
  assertNonEmptyString(sourceId, 'metadata.sourceId');
  if (typeof sourceManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceManifestSha256)) {
    throw new TypeError('metadata.sourceManifestSha256 must be a lowercase SHA-256 hash');
  }

  const ids = new Set();
  const orderedRecords = records.map((record) => structuredClone(record)).toSorted((left, right) => {
    assertNonEmptyString(left?.id, 'catalog record id');
    assertNonEmptyString(right?.id, 'catalog record id');
    return left.id.localeCompare(right.id, 'en');
  });
  for (const record of orderedRecords) {
    if (ids.has(record.id)) throw new Error(`duplicate catalog record id ${record.id}`);
    ids.add(record.id);
  }
  return { generatedAt, sourceId, sourceManifestSha256, records: orderedRecords };
}

function itemArray(page) {
  const field = page?.body?.items;
  if (Array.isArray(field)) return field;
  if (Array.isArray(field?.item)) return field.item;
  if (field?.item && typeof field.item === 'object') return [field.item];
  if (field === undefined || field === null) return [];
  throw new Error('MFDS response has an unrecognized items shape');
}

function parsePage(page) {
  if (!page || typeof page !== 'object' || page.header?.resultCode !== '00') {
    throw new Error('MFDS response is malformed or unsuccessful');
  }
  const totalCount = page.body?.totalCount;
  assertNonNegativeInteger(totalCount, 'MFDS totalCount');
  return { totalCount, items: itemArray(page) };
}

async function readEnvApiKey(projectRoot) {
  if (typeof process.env.MFDS_API_KEY === 'string' && process.env.MFDS_API_KEY !== '') {
    return process.env.MFDS_API_KEY;
  }
  let dotenv;
  try {
    dotenv = await readFile(path.join(projectRoot, '.env'), 'utf8');
  } catch {
    return null;
  }
  const line = dotenv.split(/\r?\n/).find((entry) => entry.startsWith('MFDS_API_KEY='));
  if (line) return line.slice('MFDS_API_KEY='.length).trim() || null;
  return null;
}

async function fetchMfdsPage(apiKey, pageNo) {
  const url = new URL(MFDS_ENDPOINT);
  // Match Cloud Functions exactly: portal-issued keys are already percent-encoded.
  url.searchParams.set('serviceKey', decodeURIComponent(apiKey));
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', String(ROWS_PER_PAGE));
  url.searchParams.set('pageNo', String(pageNo));
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`MFDS request failed with HTTP ${response.status}`);
  try {
    return parsePage(await response.json());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MFDS')) throw error;
    throw new Error(`MFDS response is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function collectMfdsSnapshot(apiKey, generatedAt) {
  const first = await fetchMfdsPage(apiKey, 1);
  const pageNumbers = buildMfdsPages(first.totalCount, ROWS_PER_PAGE);
  const rawManifest = createHash('sha256');
  rawManifest.update('[', 'utf8');
  let rawCount = 0;
  let needsSeparator = false;
  const records = [];

  function collectPage(items) {
    for (const item of items) {
      if (needsSeparator) rawManifest.update(',', 'utf8');
      rawManifest.update(canonicalJson(item), 'utf8');
      needsSeparator = true;
      rawCount += 1;
      const record = toPublicCatalogRecord(item, generatedAt);
      if (record) records.push(record);
    }
  }

  function reportProgress(pageNo) {
    if (shouldReportMfdsProgress(pageNo, pageNumbers.length)) {
      process.stderr.write(`fetchProgress page ${pageNo}/${pageNumbers.length} rawRecords ${rawCount}\n`);
    }
  }

  collectPage(first.items);
  reportProgress(1);
  const remainingPages = pageNumbers.slice(1);
  for (let start = 0; start < remainingPages.length; start += FETCH_CONCURRENCY) {
    const batchPageNumbers = remainingPages.slice(start, start + FETCH_CONCURRENCY);
    const pages = await Promise.all(batchPageNumbers.map(async (pageNo) => ({
      pageNo,
      page: await fetchMfdsPage(apiKey, pageNo),
    })));
    for (const { pageNo, page } of pages) {
      if (page.totalCount !== first.totalCount) {
        throw new Error('MFDS totalCount changed during snapshot collection');
      }
      collectPage(page.items);
      reportProgress(pageNo);
    }
  }
  if (rawCount !== first.totalCount) {
    throw new Error(`MFDS snapshot is incomplete: expected ${first.totalCount} raw records, received ${rawCount}`);
  }
  rawManifest.update(']', 'utf8');
  return { rawCount, records, sourceManifestSha256: rawManifest.digest('hex') };
}

async function destinationFingerprint(destination) {
  const [contents, info] = await Promise.all([readFile(destination), stat(destination)]);
  return { contents, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs };
}

function fingerprintsMatch(left, right) {
  return left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.contents.equals(right.contents);
}

async function publishExclusive(destination, contents) {
  const before = await destinationFingerprint(destination);
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    const immediatelyBeforeRename = await destinationFingerprint(destination);
    if (!fingerprintsMatch(before, immediatelyBeforeRename)) {
      throw new Error('refusing to overwrite concurrently changed snapshot destination');
    }
    await rename(temporary, destination);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => {});
  }
}

async function licensePublicationRuling(projectRoot) {
  const sourcePath = path.join(projectRoot, 'data/franchise/sources.json');
  const sources = JSON.parse(await readFile(sourcePath, 'utf8'));
  const source = sources.find(({ id }) => id === SOURCE_ID);
  if (!source || typeof source.licenseNote !== 'string' || !source.licenseNote.includes(LICENSE_EVIDENCE_URL)) {
    return 'BLOCKED: MFDS dataset license evidence is not documented in data/franchise/sources.json';
  }
  let response;
  try {
    response = await fetch(LICENSE_EVIDENCE_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return 'BLOCKED: MFDS dataset license evidence could not be re-verified from the primary source';
  }
  if (!response.ok || !(await response.text()).includes('이용허락범위 제한 없음')) {
    return 'BLOCKED: MFDS dataset primary source no longer verifies unrestricted license scope';
  }
  return null;
}

async function main() {
  const write = process.argv.slice(2).includes('--write');
  if (process.argv.slice(2).some((argument) => argument !== '--write')) {
    throw new Error('usage: node scripts/build-mfds-franchise-data.mjs [--write]');
  }
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const apiKey = await readEnvApiKey(projectRoot);
  if (!apiKey) throw new Error('MFDS_API_KEY is required');

  if (write) {
    const blocked = await licensePublicationRuling(projectRoot);
    if (blocked) throw new Error(blocked);
  }

  const startedAt = Date.now();
  const generatedAt = new Date().toISOString();
  const collected = await collectMfdsSnapshot(apiKey, generatedAt);
  const existingBrands = JSON.parse(await readFile(path.join(projectRoot, 'data/franchise/brands.json'), 'utf8'));
  const reconciled = reconcilePublicBrands(collected.records, existingBrands, generatedAt);
  const snapshot = canonicalSnapshot(reconciled.records, {
    generatedAt,
    sourceId: SOURCE_ID,
    sourceManifestSha256: collected.sourceManifestSha256,
  });
  const contents = `${canonicalJson(snapshot)}\n`;
  const brandsContents = `${JSON.stringify(reconciled.brands, null, 2)}\n`;
  const snapshotSha256 = createHash('sha256').update(contents, 'utf8').digest('hex');

  if (write) {
    await publishExclusive(path.join(projectRoot, 'data/franchise/brands.json'), brandsContents);
    await publishExclusive(path.join(projectRoot, SNAPSHOT_RELATIVE_PATH), contents);
  }
  process.stdout.write([
    `rawRecords ${collected.rawCount}`,
    `${write ? 'publicRecords' : 'plannedPublicRecords'} ${snapshot.records.length}`,
    `brands ${reconciled.brands.length}`,
    `snapshotSha256 ${snapshotSha256}`,
    `elapsedMs ${Date.now() - startedAt}`,
    write ? 'written' : 'dry-run (no write)',
  ].join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
