#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  cp, link, mkdtemp, open, readFile, rename, rm, stat, unlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMfdsFoodItem } from '../src/lib/mfdsParser.js';
import { normalizeCatalogText } from '../src/lib/franchiseCatalog.js';
import { loadReviewedCatalogFiles } from './validate-franchise-data.mjs';

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

function hasMissingFranchiseMaker(rawItem) {
  if (rawItem?.FOOD_OR_CD !== '2') return false;
  const maker = rawItem.MAKER_NM;
  return maker === null
    || maker === undefined
    || (typeof maker === 'string' && normalizeCatalogText(maker) === '');
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
  if (hasMissingFranchiseMaker(rawItem)) return null;

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
  const { generatedAt, sourceId, sourceManifestSha256, excludedMissingMaker } = metadata;
  assertIsoUtcDate(generatedAt, 'metadata.generatedAt');
  assertNonEmptyString(sourceId, 'metadata.sourceId');
  if (typeof sourceManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceManifestSha256)) {
    throw new TypeError('metadata.sourceManifestSha256 must be a lowercase SHA-256 hash');
  }
  assertNonNegativeInteger(excludedMissingMaker, 'metadata.excludedMissingMaker');

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
  return { generatedAt, sourceId, sourceManifestSha256, excludedMissingMaker, records: orderedRecords };
}

function itemArray(page) {
  const field = page?.body?.items;
  if (Array.isArray(field)) return field;
  if (Array.isArray(field?.item)) return field.item;
  if (field?.item && typeof field.item === 'object') return [field.item];
  if (field === undefined || field === null) return [];
  throw new Error('MFDS response has an unrecognized items shape');
}

function parseMfdsInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`MFDS response ${label} must be a non-negative safe integer`);
  }
  return value;
}

/** Returns the exact item count the requested page must contain. */
export function expectedMfdsItemCount(totalCount, rowsPerPage, pageNo) {
  assertNonNegativeInteger(totalCount, 'totalCount');
  if (!Number.isSafeInteger(rowsPerPage) || rowsPerPage <= 0) {
    throw new TypeError('rowsPerPage must be a positive safe integer');
  }
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) {
    throw new TypeError('pageNo must be a positive safe integer');
  }
  const pageCount = Math.ceil(totalCount / rowsPerPage);
  if (totalCount === 0 && pageNo === 1) return 0;
  if (pageNo > pageCount) {
    throw new Error(`MFDS response pageNo ${pageNo} is outside totalCount ${totalCount}`);
  }
  return Math.min(rowsPerPage, totalCount - ((pageNo - 1) * rowsPerPage));
}

/** Refuses a successful-but-shifted, duplicated, or incomplete MFDS page. */
export function validateMfdsPage(page, { pageNo, totalCount = undefined, rowsPerPage = ROWS_PER_PAGE } = {}) {
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) {
    throw new TypeError('pageNo must be a positive safe integer');
  }
  if (!Number.isSafeInteger(rowsPerPage) || rowsPerPage <= 0) {
    throw new TypeError('rowsPerPage must be a positive safe integer');
  }
  if (!page || typeof page !== 'object' || page.header?.resultCode !== '00') {
    throw new Error('MFDS response is malformed or unsuccessful');
  }
  const responsePageNo = parseMfdsInteger(page.body?.pageNo, 'pageNo');
  const responseRowsPerPage = parseMfdsInteger(page.body?.numOfRows, 'numOfRows');
  const responseTotalCount = parseMfdsInteger(page.body?.totalCount, 'totalCount');
  if (responsePageNo !== pageNo) {
    throw new Error(`MFDS response pageNo ${responsePageNo} does not match requested pageNo ${pageNo}`);
  }
  if (responseRowsPerPage !== rowsPerPage) {
    throw new Error(`MFDS response numOfRows ${responseRowsPerPage} does not match requested numOfRows ${rowsPerPage}`);
  }
  if (totalCount !== undefined && responseTotalCount !== totalCount) {
    throw new Error('MFDS totalCount changed during snapshot collection');
  }
  const items = itemArray(page);
  const expectedCount = expectedMfdsItemCount(responseTotalCount, rowsPerPage, pageNo);
  if (items.length !== expectedCount) {
    throw new Error(`MFDS response page ${pageNo} expected ${expectedCount} items, received ${items.length}`);
  }
  return { totalCount: responseTotalCount, items };
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

export async function fetchMfdsPage(apiKey, pageNo, {
  fetchImpl = fetch,
  rowsPerPage = ROWS_PER_PAGE,
  timeoutMs = REQUEST_TIMEOUT_MS,
  totalCount = undefined,
} = {}) {
  assertNonEmptyString(apiKey, 'MFDS API key');
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw new TypeError('pageNo must be a positive safe integer');
  if (!Number.isSafeInteger(rowsPerPage) || rowsPerPage <= 0) throw new TypeError('rowsPerPage must be a positive safe integer');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive safe integer');
  const url = new URL(MFDS_ENDPOINT);
  // Match Cloud Functions exactly: portal-issued keys are already percent-encoded.
  url.searchParams.set('serviceKey', decodeURIComponent(apiKey));
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', String(rowsPerPage));
  url.searchParams.set('pageNo', String(pageNo));
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`MFDS request failed with HTTP ${response.status}`);
  try {
    return validateMfdsPage(await response.json(), { pageNo, totalCount, rowsPerPage });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MFDS')) throw error;
    throw new Error(`MFDS response is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function collectMfdsSnapshot(apiKey, generatedAt, {
  fetchPage = fetchMfdsPage,
  rowsPerPage = ROWS_PER_PAGE,
  concurrency = FETCH_CONCURRENCY,
  reportProgress = null,
} = {}) {
  if (!Number.isSafeInteger(rowsPerPage) || rowsPerPage <= 0) throw new TypeError('rowsPerPage must be a positive safe integer');
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) throw new TypeError('concurrency must be a positive safe integer');
  const first = await fetchPage(apiKey, 1, { rowsPerPage });
  const pageNumbers = buildMfdsPages(first.totalCount, rowsPerPage);
  const rawManifest = createHash('sha256');
  rawManifest.update('[', 'utf8');
  let rawCount = 0;
  let excludedMissingMaker = 0;
  let needsSeparator = false;
  const records = [];

  function collectPage(items) {
    for (const item of items) {
      if (needsSeparator) rawManifest.update(',', 'utf8');
      rawManifest.update(canonicalJson(item), 'utf8');
      needsSeparator = true;
      rawCount += 1;
      if (hasMissingFranchiseMaker(item)) {
        excludedMissingMaker += 1;
        continue;
      }
      const record = toPublicCatalogRecord(item, generatedAt);
      if (record) records.push(record);
    }
  }

  function emitProgress(pageNo) {
    if (shouldReportMfdsProgress(pageNo, pageNumbers.length)) {
      if (reportProgress) {
        reportProgress({ pageNo, totalPages: pageNumbers.length, rawCount });
      } else {
        process.stderr.write(`fetchProgress page ${pageNo}/${pageNumbers.length} rawRecords ${rawCount}\n`);
      }
    }
  }

  collectPage(first.items);
  emitProgress(1);
  const remainingPages = pageNumbers.slice(1);
  for (let start = 0; start < remainingPages.length; start += concurrency) {
    const batchPageNumbers = remainingPages.slice(start, start + concurrency);
    const pages = await Promise.all(batchPageNumbers.map(async (pageNo) => ({
      pageNo,
      page: await fetchPage(apiKey, pageNo, { rowsPerPage, totalCount: first.totalCount }),
    })));
    for (const { pageNo, page } of pages) {
      if (page.totalCount !== first.totalCount) throw new Error('MFDS totalCount changed during snapshot collection');
      const expectedCount = expectedMfdsItemCount(first.totalCount, rowsPerPage, pageNo);
      if (!Array.isArray(page.items) || page.items.length !== expectedCount) {
        throw new Error(`MFDS response page ${pageNo} expected ${expectedCount} items, received ${Array.isArray(page.items) ? page.items.length : 'invalid'}`);
      }
      collectPage(page.items);
      emitProgress(pageNo);
    }
  }
  if (rawCount !== first.totalCount) {
    throw new Error(`MFDS snapshot is incomplete: expected ${first.totalCount} raw records, received ${rawCount}`);
  }
  rawManifest.update(']', 'utf8');
  return {
    rawCount,
    records,
    excludedMissingMaker,
    sourceManifestSha256: rawManifest.digest('hex'),
  };
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

function fingerprintsHaveSameContents(left, right) {
  return left.size === right.size && left.contents.equals(right.contents);
}

async function writeExclusiveTemporary(destination, contents, label = 'new') {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.${label}.${createHash('sha256').update(contents, 'utf8').digest('hex').slice(0, 12)}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    return temporary;
  } finally {
    await handle?.close();
    if (handle) await unlink(temporary).catch(() => {});
  }
}

function temporarySibling(destination, label) {
  return path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.${label}`,
  );
}

async function checkpoint(onCheckpoint, phase, destination) {
  if (onCheckpoint) await onCheckpoint({ phase, destination });
}

async function destinationMatchesContents(destination, contents) {
  try {
    return (await readFile(destination, 'utf8')) === contents;
  } catch {
    return false;
  }
}

async function restoreWithoutClobber(source, destination, linkFile) {
  try {
    await linkFile(source, destination);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

/** Validates the complete candidate catalog in an isolated overlay before publication. */
export async function validateCatalogPair(projectRoot, { brandsContents, snapshotContents }) {
  assertNonEmptyString(projectRoot, 'projectRoot');
  if (typeof brandsContents !== 'string' || typeof snapshotContents !== 'string') {
    throw new TypeError('catalog candidates must be strings');
  }
  const stagingRoot = await mkdtemp(path.join(tmpdir(), 'meal-calendar-catalog-preflight-'));
  try {
    await cp(path.join(projectRoot, 'data'), path.join(stagingRoot, 'data'), { recursive: true });
    await Promise.all([
      writeFile(path.join(stagingRoot, 'data/franchise/brands.json'), brandsContents, 'utf8'),
      writeFile(path.join(stagingRoot, SNAPSHOT_RELATIVE_PATH), snapshotContents, 'utf8'),
    ]);
    await loadReviewedCatalogFiles(stagingRoot);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

/**
 * Replaces the reviewed brands and public snapshot as one recoverable pair.
 * A verified old path is first moved to quarantine, then the new sibling is
 * hard-linked into the now-empty destination with O_EXCL-equivalent EEXIST
 * refusal. Rollback follows the same identity-bound, no-clobber sequence.
 */
export async function publishCatalogPair(projectRoot, { brandsContents, snapshotContents }, {
  renameFile = rename,
  linkFile = link,
  onCheckpoint = null,
} = {}) {
  await validateCatalogPair(projectRoot, { brandsContents, snapshotContents });
  const entries = [
    { destination: path.join(projectRoot, 'data/franchise/brands.json'), contents: brandsContents },
    { destination: path.join(projectRoot, SNAPSHOT_RELATIVE_PATH), contents: snapshotContents },
  ];
  const before = await Promise.all(entries.map(({ destination }) => destinationFingerprint(destination)));
  for (let index = 0; index < entries.length; index += 1) {
    entries[index].before = before[index];
    entries[index].temporary = null;
    entries[index].backup = null;
    entries[index].newRecovery = null;
    entries[index].restoreTemporary = null;
    entries[index].restoreFingerprint = null;
    entries[index].quarantine = null;
    entries[index].rollbackQuarantine = null;
    entries[index].newFingerprint = null;
    entries[index].oldMoved = false;
    entries[index].published = false;
  }
  let completed = false;

  async function restoreForeignMove(entry, quarantine) {
    if (!(await restoreWithoutClobber(quarantine, entry.destination, linkFile))) {
      throw new Error(`refusing to restore foreign concurrent data at ${path.basename(entry.destination)}`);
    }
  }

  async function moveVerifiedOld(entry) {
    await checkpoint(onCheckpoint, 'before-quarantine', entry.destination);
    const quarantine = temporarySibling(entry.destination, 'quarantine');
    await renameFile(entry.destination, quarantine);
    entry.quarantine = quarantine;
    const moved = await destinationFingerprint(quarantine);
    if (!fingerprintsMatch(moved, entry.before)) {
      await restoreForeignMove(entry, quarantine);
      throw new Error(`refusing to publish over foreign concurrent data at ${path.basename(entry.destination)}`);
    }
    entry.oldMoved = true;
  }

  async function restoreEntry(entry) {
    if (!entry.oldMoved) return true;
    async function linkIndependentBackup() {
      const backup = await destinationFingerprint(entry.backup);
      if (!fingerprintsHaveSameContents(backup, entry.before)) return false;
      const restoreContents = backup.contents.toString('utf8');
      entry.restoreTemporary = await writeExclusiveTemporary(entry.destination, restoreContents, 'restore');
      entry.restoreFingerprint = await destinationFingerprint(entry.restoreTemporary);
      return restoreWithoutClobber(entry.restoreTemporary, entry.destination, linkFile);
    }
    async function verifyRestoredPath() {
      await checkpoint(onCheckpoint, 'after-rollback-restore-link', entry.destination);
      try {
        const [destination, backup, restoration] = await Promise.all([
          destinationFingerprint(entry.destination),
          destinationFingerprint(entry.backup),
          destinationFingerprint(entry.restoreTemporary),
        ]);
        return fingerprintsMatch(destination, restoration)
          && fingerprintsHaveSameContents(destination, backup)
          && fingerprintsHaveSameContents(backup, entry.before);
      } catch {
        return false;
      }
    }
    async function restoreVerifiedBackup() {
      const restored = await linkIndependentBackup();
      if (!restored || !(await verifyRestoredPath())) return false;
      await checkpoint(onCheckpoint, 'after-rollback-restore-verification', entry.destination);
      return true;
    }
    if (!entry.published) {
      return restoreVerifiedBackup();
    }

    await checkpoint(onCheckpoint, 'before-rollback-quarantine', entry.destination);
    const rollbackQuarantine = temporarySibling(entry.destination, 'rollback-quarantine');
    await renameFile(entry.destination, rollbackQuarantine);
    entry.rollbackQuarantine = rollbackQuarantine;
    const moved = await destinationFingerprint(rollbackQuarantine);
    if (!fingerprintsMatch(moved, entry.newFingerprint)) {
      await restoreForeignMove(entry, rollbackQuarantine);
      return false;
    }
    return restoreVerifiedBackup();
  }

  function retainedRecoveryError(error, rollbackFailures) {
    const recoveryArtifacts = entries.map((entry) => ({
      destination: entry.destination,
      old: entry.backup,
      new: entry.newRecovery,
    })).filter(({ old, new: replacement }) => old && replacement);
    const rollbackReport = rollbackFailures.length > 0
      ? `; ${rollbackFailures.join('; ')}`
      : '';
    const artifactReport = recoveryArtifacts
      .map(({ destination, old, new: replacement }) => `${path.basename(destination)} old=${old} new=${replacement}`)
      .join('; ');
    const retained = new Error(
      `${error instanceof Error ? error.message : String(error)}${rollbackReport}; recovery artifacts retained: ${artifactReport}`,
      { cause: error },
    );
    retained.recoveryArtifacts = recoveryArtifacts;
    return retained;
  }

  try {
    for (const entry of entries) {
      entry.backup = await writeExclusiveTemporary(entry.destination, entry.before.contents.toString('utf8'), 'old');
      entry.newRecovery = await writeExclusiveTemporary(entry.destination, entry.contents, 'new');
    }
    for (const entry of entries) {
      entry.temporary = await writeExclusiveTemporary(entry.destination, entry.contents, 'publish');
      entry.newFingerprint = await destinationFingerprint(entry.temporary);
    }
    const beforePublication = await Promise.all(entries.map(({ destination }) => destinationFingerprint(destination)));
    if (!before.every((fingerprint, index) => fingerprintsMatch(fingerprint, beforePublication[index]))) {
      throw new Error('refusing to overwrite concurrently changed catalog destination');
    }
    for (const entry of entries) {
      await moveVerifiedOld(entry);
      await checkpoint(onCheckpoint, 'before-commit', entry.destination);
      if (!(await restoreWithoutClobber(entry.temporary, entry.destination, linkFile))) {
        throw new Error(`refusing to publish because ${path.basename(entry.destination)} was concurrently recreated`);
      }
      const published = await destinationFingerprint(entry.destination);
      if (!fingerprintsMatch(published, entry.newFingerprint)) {
        throw new Error(`catalog destination changed during publication: ${path.basename(entry.destination)}`);
      }
      entry.published = true;
    }
    await loadReviewedCatalogFiles(projectRoot);
    for (const entry of entries) {
      if (!(await destinationMatchesContents(entry.destination, entry.contents))) {
        throw new Error('catalog destination changed after publication validation');
      }
    }
    completed = true;
  } catch (error) {
    const rollbackFailures = [];
    for (const entry of entries.toReversed()) {
      try {
        if (!(await restoreEntry(entry))) {
          rollbackFailures.push(`refused rollback for concurrently changed ${path.basename(entry.destination)}`);
        }
      } catch (rollbackError) {
        rollbackFailures.push(`rollback failed for ${path.basename(entry.destination)}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    throw retainedRecoveryError(error, rollbackFailures);
  } finally {
    if (completed) {
      await Promise.all(entries.flatMap((entry) => [
        entry.temporary,
        entry.backup,
        entry.newRecovery,
        entry.restoreTemporary,
        entry.quarantine,
        entry.rollbackQuarantine,
      ].filter(Boolean).map((artifact) => unlink(artifact).catch(() => {}))));
    }
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
    excludedMissingMaker: collected.excludedMissingMaker,
  });
  const contents = `${canonicalJson(snapshot)}\n`;
  const brandsContents = `${JSON.stringify(reconciled.brands, null, 2)}\n`;
  const snapshotSha256 = createHash('sha256').update(contents, 'utf8').digest('hex');

  if (write) {
    await publishCatalogPair(projectRoot, { brandsContents, snapshotContents: contents });
  }
  process.stdout.write([
    `rawRecords ${collected.rawCount}`,
    `${write ? 'publicRecords' : 'plannedPublicRecords'} ${snapshot.records.length}`,
    `excludedMissingMaker ${collected.excludedMissingMaker}`,
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
