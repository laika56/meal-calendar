#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBarcodeCatalog,
  buildFoodQrCatalog,
  buildTraceCatalog,
  indexMfdsNutritionRows,
} from '../src/lib/barcodeCatalogSources.js';
import { fetchMfdsPage } from './build-mfds-franchise-data.mjs';
import { buildDataGoUrl, normalizeDataGoPage } from './measure-barcode-sources.mjs';

const PAGE_SIZE = 500;
const CONCURRENCY = 4;
const ENDPOINTS = {
  list: 'https://apis.data.go.kr/1471000/FoodQrInfoService01/getFoodQrProdList01',
  labels: 'https://apis.data.go.kr/1471000/FoodQrInfoService01/getFoodQrIndctInfo01',
  nutrients: 'https://apis.data.go.kr/1471000/FoodQrInfoService01/getFoodQrProdNsd01',
  trace: 'https://apis.data.go.kr/1471000/FoodHistTrckMngPrdlstRegInfo/getFoodHistTrckMngPrdlstRegInfo',
};

export async function withBoundedTimeoutRetry(operation, { attempts = 3, onRetry = () => {} } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const isTimeout = error?.name === 'TimeoutError'
        || error?.message === 'MFDS response is malformed: The operation was aborted due to timeout';
      if (!isTimeout || attempt === attempts) throw error;
      onRetry(attempt);
    }
  }
  throw new Error('unreachable retry state');
}

async function loadKey() {
  if (process.env.MFDS_API_KEY) return process.env.MFDS_API_KEY;
  const dotenv = await readFile(path.resolve('.env'), 'utf8');
  const line = dotenv.split(/\r?\n/u).find((value) => value.startsWith('MFDS_API_KEY='));
  if (!line?.slice(13).trim()) throw new Error('MFDS_API_KEY is required');
  return line.slice(13).trim();
}

async function fetchPage(endpoint, sourceId, key, pageNo, totalCount) {
  const url = buildDataGoUrl({ baseUrl: endpoint, serviceKey: key, pageNo, pageSize: PAGE_SIZE });
  const response = await withBoundedTimeoutRetry(
    () => fetch(url, { signal: AbortSignal.timeout(8_000) }),
    { onRetry: (attempt) => process.stderr.write(`${sourceId}: timeout retry ${attempt}/2 page ${pageNo}\n`) },
  );
  if (!response.ok) throw new Error(`${sourceId}: HTTP ${response.status}`);
  const page = normalizeDataGoPage(await response.json(), sourceId);
  if (page.pageNo !== pageNo) throw new Error(`${sourceId}: shifted page ${page.pageNo}`);
  if (totalCount !== undefined && page.totalCount !== totalCount) {
    throw new Error(`${sourceId}: total count changed`);
  }
  const expected = Math.min(PAGE_SIZE, Math.max(page.totalCount - ((pageNo - 1) * PAGE_SIZE), 0));
  if (page.rows.length !== expected) {
    throw new Error(`${sourceId}: page ${pageNo} expected ${expected} rows, received ${page.rows.length}`);
  }
  return page;
}

async function fetchAll(endpoint, sourceId, key) {
  const first = await fetchPage(endpoint, sourceId, key, 1);
  const pageCount = Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE));
  const rows = [...first.rows];
  process.stderr.write(`${sourceId}: page 1/${pageCount}\n`);
  for (let start = 2; start <= pageCount; start += CONCURRENCY) {
    const numbers = Array.from(
      { length: Math.min(CONCURRENCY, pageCount - start + 1) },
      (_, index) => start + index,
    );
    const pages = await Promise.all(numbers.map((pageNo) => (
      fetchPage(endpoint, sourceId, key, pageNo, first.totalCount)
    )));
    for (const page of pages) rows.push(...page.rows);
    const completed = numbers.at(-1);
    if (completed === pageCount || completed % 25 < CONCURRENCY) {
      process.stderr.write(`${sourceId}: page ${completed}/${pageCount}\n`);
    }
  }
  if (rows.length !== first.totalCount) throw new Error(`${sourceId}: incomplete source snapshot`);
  return rows;
}

async function fetchAllNutrition(key) {
  const fetchOne = (pageNo, totalCount) => withBoundedTimeoutRetry(
    () => fetchMfdsPage(key, pageNo, {
      rowsPerPage: PAGE_SIZE,
      totalCount,
      timeoutMs: 20_000,
    }),
    { onRetry: (attempt) => process.stderr.write(`mfds-nutrition: timeout retry ${attempt}/2 page ${pageNo}\n`) },
  );
  const first = await fetchOne(1, undefined);
  const pages = Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE));
  const nutritionIndex = new Map();
  const conflictedReports = new Set();
  const material = createHash('sha256');
  material.update('[');
  let rowCount = 0;
  function collect(items) {
    for (const item of items) {
      if (rowCount > 0) material.update(',');
      material.update(JSON.stringify(item));
      rowCount += 1;
    }
    indexMfdsNutritionRows(nutritionIndex, conflictedReports, items);
  }
  collect(first.items);
  process.stderr.write(`mfds-nutrition: page 1/${pages}\n`);
  for (let start = 2; start <= pages; start += CONCURRENCY) {
    const numbers = Array.from({ length: Math.min(CONCURRENCY, pages - start + 1) }, (_, i) => start + i);
    const batch = await Promise.all(numbers.map((pageNo) => (
      fetchOne(pageNo, first.totalCount)
    )));
    for (const page of batch) collect(page.items);
    const completed = numbers.at(-1);
    if (completed === pages || completed % 25 < CONCURRENCY) {
      process.stderr.write(`mfds-nutrition: page ${completed}/${pages}\n`);
    }
  }
  if (rowCount !== first.totalCount) throw new Error('mfds-nutrition: incomplete source snapshot');
  material.update(']');
  return {
    nutritionIndex,
    conflictedReports,
    rows: rowCount,
    sha256: material.digest('hex'),
  };
}

function sourceHash(rows) {
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

export async function collectFoodQrCatalog({ key, verifiedAt }) {
  const [list, labels, nutrients, trace, mfdsNutrition] = await Promise.all([
    fetchAll(ENDPOINTS.list, 'foodqr-list', key),
    fetchAll(ENDPOINTS.labels, 'foodqr-label', key),
    fetchAll(ENDPOINTS.nutrients, 'foodqr-nutrients', key),
    fetchAll(ENDPOINTS.trace, 'trace', key),
    fetchAllNutrition(key),
  ]);
  const foodQr = buildFoodQrCatalog(labels, nutrients, { verifiedAt, listRows: list });
  const joined = buildTraceCatalog(trace, mfdsNutrition.nutritionIndex, {
    verifiedAt,
    conflictedReports: mfdsNutrition.conflictedReports,
    nutritionCount: mfdsNutrition.rows,
  });
  const combined = buildBarcodeCatalog([
    ...foodQr.records.map((candidate) => ({ candidate })),
    ...joined.records.map((candidate) => ({ candidate })),
  ]);
  const exclusionCounts = {};
  for (const counts of [foodQr.exclusionCounts, joined.exclusionCounts, combined.exclusionCounts]) {
    for (const [reason, count] of Object.entries(counts)) exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + count;
  }
  const catalog = {
    ...combined,
    exclusionCounts: Object.fromEntries(Object.entries(exclusionCounts).toSorted(([a], [b]) => a.localeCompare(b))),
    sourceCounts: { ...foodQr.sourceCounts, ...joined.sourceCounts },
  };
  return {
    ...catalog,
    sourceSnapshots: {
      list: { rows: list.length, sha256: sourceHash(list) },
      labels: { rows: labels.length, sha256: sourceHash(labels) },
      nutrients: { rows: nutrients.length, sha256: sourceHash(nutrients) },
      trace: { rows: trace.length, sha256: sourceHash(trace) },
      mfdsNutrition: { rows: mfdsNutrition.rows, sha256: mfdsNutrition.sha256 },
    },
  };
}

function review(catalog, verifiedAt) {
  const target = catalog.records.find(({ barcode }) => barcode === '8801392194078');
  return `# Barcode Catalog Review\n\n`
    + `- verifiedAt: ${verifiedAt}\n`
    + `- records: ${catalog.manifest.recordCount}\n`
    + `- materialSha256: ${catalog.manifest.materialSha256}\n`
    + `- sourceCounts: ${JSON.stringify(catalog.sourceCounts)}\n`
    + `- exclusions: ${JSON.stringify(catalog.exclusionCounts)}\n`
    + `- sourceSnapshots: ${JSON.stringify(catalog.sourceSnapshots)}\n`
    + `- target 8801392194078: ${target ? `hit (${target.source.sourceId})` : 'miss'}\n`;
}

async function writeArtifacts(directory, catalog, verifiedAt) {
  await mkdir(directory);
  const files = [
    ['barcode-foods.ndjson', `${catalog.records.map((record) => JSON.stringify(record)).join('\n')}\n`],
    ['barcode-catalog-manifest.json', `${JSON.stringify(catalog.manifest, null, 2)}\n`],
    ['BARCODE_CATALOG_REVIEW.md', review(catalog, verifiedAt)],
  ];
  for (const [name, contents] of files) {
    await writeFile(path.join(directory, name), contents, { flag: 'wx' });
  }
}

async function main() {
  const args = process.argv.slice(2);
  let output = null;
  if (args.length === 2 && args[0] === '--write') output = args[1];
  else if (args.length !== 0) throw new Error('usage: build-barcode-catalog.mjs [--write fresh-directory]');
  const verifiedAt = new Date().toISOString().slice(0, 10);
  const catalog = await collectFoodQrCatalog({ key: await loadKey(), verifiedAt });
  if (output !== null) await writeArtifacts(path.resolve(output), catalog, verifiedAt);
  process.stdout.write(`${JSON.stringify({
    mode: output === null ? 'dry-run' : 'written',
    records: catalog.manifest.recordCount,
    materialSha256: catalog.manifest.materialSha256,
    sourceCounts: catalog.sourceCounts,
    exclusionCounts: catalog.exclusionCounts,
    sourceSnapshots: catalog.sourceSnapshots,
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
