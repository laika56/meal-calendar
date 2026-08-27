import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { loadReviewedCatalogFiles, catalogManifest } from '../scripts/validate-franchise-data.mjs';
import { canonicalJson, canonicalJsonSha256 } from '../scripts/canonical-json.mjs';
import { validateCatalogRecord } from './shared/franchiseCatalog.js';

const CURRENT_POINTER_PATH = 'franchiseCatalogState/current';
const RUNS_PATH = 'franchiseCatalogRuns';
const MAX_BATCH_WRITES = 400;

function clone(value) {
  return structuredClone(value);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertUniqueIds(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const ids = new Set();
  for (const value of values) {
    assertPlainObject(value, `${label} entry`);
    if (typeof value.id !== 'string' || value.id === '') {
      throw new TypeError(`${label} entry id must be a non-empty string`);
    }
    if (ids.has(value.id)) throw new TypeError(`duplicate ${label.slice(0, -1)} id ${value.id}`);
    ids.add(value.id);
  }
}

function sortedDocuments(runId, catalog) {
  const runPath = `${RUNS_PATH}/${runId}`;
  return [
    ...catalog.sources.map((source) => ({
      path: `${runPath}/sources/${source.id}`,
      data: clone(source),
    })),
    ...catalog.brands.map((brand) => ({
      path: `${runPath}/brands/${brand.id}`,
      data: clone(brand),
    })),
    ...catalog.records.map((record) => ({
      path: `${runPath}/foods/${record.id}`,
      data: clone(record),
    })),
  ];
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function pointerForPlan(plan) {
  return {
    runId: plan.runId,
    counts: clone(plan.counts),
    catalogSha256: plan.catalogSha256,
    payloadSha256: plan.payloadSha256,
  };
}

function manifestPointer(pointer) {
  if (pointer === null || pointer === undefined) return pointer;
  assertPlainObject(pointer, 'currentPointer');
  return {
    runId: pointer.runId,
    counts: pointer.counts,
    catalogSha256: pointer.catalogSha256,
    payloadSha256: pointer.payloadSha256,
  };
}

/**
 * Builds a deterministic, all-or-nothing versioned Firestore import plan.
 * This is pure: it never changes reviewed catalog input or contacts Firestore.
 */
export function buildCatalogImportPlan(currentPointer, reviewedCatalog, runId) {
  assertPlainObject(reviewedCatalog, 'reviewedCatalog');
  assertUniqueIds(reviewedCatalog.sources, 'sources');
  assertUniqueIds(reviewedCatalog.brands, 'brands');
  assertUniqueIds(reviewedCatalog.records, 'foods');

  const sources = clone(reviewedCatalog.sources).toSorted((left, right) => left.id.localeCompare(right.id, 'en'));
  const brands = clone(reviewedCatalog.brands).toSorted((left, right) => left.id.localeCompare(right.id, 'en'));
  const records = reviewedCatalog.records
    .map((record) => validateCatalogRecord(record))
    .toSorted((left, right) => left.id.localeCompare(right.id, 'en'));
  const catalog = { sources, brands, records };
  const manifest = catalogManifest(catalog);
  const resolvedRunId = runId ?? `franchise-catalog-${manifest.sha256}`;
  if (typeof resolvedRunId !== 'string' || resolvedRunId === '') {
    throw new TypeError('runId must be a non-empty string');
  }

  const documents = sortedDocuments(resolvedRunId, catalog);
  const payloadSha256 = canonicalJsonSha256([...documents].toSorted((left, right) => left.path.localeCompare(right.path, 'en')));
  const counts = {
    sources: sources.length,
    brands: brands.length,
    foods: records.length,
  };
  const expectedPointer = {
    runId: resolvedRunId,
    counts,
    catalogSha256: manifest.sha256,
    payloadSha256,
  };
  const preflightPointer = currentPointer === undefined ? null : clone(currentPointer);
  const unchanged = preflightPointer !== null && sameCanonical(
    pointerForPlan({ ...expectedPointer, counts }),
    manifestPointer(preflightPointer),
  );
  const run = {
    path: `${RUNS_PATH}/${resolvedRunId}`,
    data: {
      status: 'staging',
      ...expectedPointer,
    },
  };

  return {
    runId: resolvedRunId,
    currentPointer: preflightPointer,
    unchanged,
    counts: clone(counts),
    catalogSha256: manifest.sha256,
    payloadSha256,
    run,
    documents,
    batches: unchanged ? [] : chunk(documents, MAX_BATCH_WRITES),
  };
}

async function verifyStagedRun(firestore, plan) {
  const manifestSnapshot = await firestore.doc(plan.run.path).get();
  if (!manifestSnapshot.exists || !sameCanonical(manifestSnapshot.data(), plan.run.data)) {
    throw new Error('staged run manifest mismatch');
  }

  const collections = ['sources', 'brands', 'foods'];
  const rereadDocuments = [];
  for (const collection of collections) {
    const snapshot = await firestore.collection(`${plan.run.path}/${collection}`).get();
    for (const document of snapshot.docs) {
      rereadDocuments.push({
        path: `${plan.run.path}/${collection}/${document.id}`,
        data: document.data(),
      });
    }
  }
  const expectedCounts = plan.counts;
  const actualCounts = {
    sources: rereadDocuments.filter(({ path: documentPath }) => documentPath.includes('/sources/')).length,
    brands: rereadDocuments.filter(({ path: documentPath }) => documentPath.includes('/brands/')).length,
    foods: rereadDocuments.filter(({ path: documentPath }) => documentPath.includes('/foods/')).length,
  };
  if (!sameCanonical(actualCounts, expectedCounts)) {
    throw new Error('staged document count mismatch');
  }
  const ordered = rereadDocuments.toSorted((left, right) => left.path.localeCompare(right.path, 'en'));
  const expected = plan.documents.toSorted((left, right) => left.path.localeCompare(right.path, 'en'));
  if (ordered.length !== expected.length || canonicalJsonSha256(ordered) !== plan.payloadSha256) {
    throw new Error('staged payload hash mismatch');
  }
}

/** Writes a plan only after it is complete; a failed or drifting plan remains staging and unreferenced. */
export async function applyCatalogImport(firestore, plan, { now = () => new Date().toISOString() } = {}) {
  assertPlainObject(plan, 'plan');
  if (plan.unchanged) return { status: 'unchanged', runId: plan.runId };

  await firestore.doc(plan.run.path).set(plan.run.data);
  for (const documents of plan.batches) {
    const batch = firestore.batch();
    for (const document of documents) batch.set(firestore.doc(document.path), document.data);
    await batch.commit();
  }

  await verifyStagedRun(firestore, plan);
  const publishedAt = now();
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) {
    throw new TypeError('now must return an ISO date string');
  }
  const nextPointer = { ...pointerForPlan(plan), publishedAt };
  await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(firestore.doc(CURRENT_POINTER_PATH));
    const actualPointer = currentSnapshot.exists ? currentSnapshot.data() : null;
    if (!sameCanonical(actualPointer, plan.currentPointer)) {
      throw new Error('catalog pointer changed since preflight');
    }
    transaction.set(firestore.doc(plan.run.path), { ...plan.run.data, status: 'ready' });
    transaction.set(firestore.doc(CURRENT_POINTER_PATH), nextPointer);
  });
  return { status: 'ready', runId: plan.runId, pointer: nextPointer };
}

export async function runCatalogImportCli({
  args = process.argv.slice(2),
  firestore,
  write = (line) => process.stdout.write(line),
} = {}) {
  if (args.some((argument) => argument !== '--apply')) {
    throw new Error('usage: node functions/import-franchise-catalog.mjs [--apply]');
  }
  const apply = args.includes('--apply');
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = await loadReviewedCatalogFiles(projectRoot);
  const db = firestore ?? getFirestore(getApps().length > 0 ? getApps()[0] : initializeApp());
  const pointerSnapshot = await db.doc(CURRENT_POINTER_PATH).get();
  const plan = buildCatalogImportPlan(pointerSnapshot.exists ? pointerSnapshot.data() : null, catalog);
  const lines = [
    `mode ${apply ? 'apply' : 'dry-run'}`,
    `runId ${plan.runId}`,
    `sources ${plan.counts.sources}`,
    `brands ${plan.counts.brands}`,
    `foods ${plan.counts.foods}`,
    `catalogSha256 ${plan.catalogSha256}`,
    `payloadSha256 ${plan.payloadSha256}`,
    `writes ${plan.unchanged ? 0 : plan.documents.length + 1}`,
  ];
  if (!apply) {
    write(`${lines.join('\n')}\n`);
    return { status: plan.unchanged ? 'unchanged' : 'dry-run', plan };
  }
  const result = await applyCatalogImport(db, plan);
  write(`${[...lines, `status ${result.status}`].join('\n')}\n`);
  return { ...result, plan };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCatalogImportCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
