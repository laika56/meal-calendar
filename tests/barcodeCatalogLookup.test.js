import test from 'node:test';
import assert from 'node:assert/strict';

import { queryBarcodeCatalog } from '../functions/shared/barcodeCatalogLookup.js';

const record = {
  barcode: '0036000291452',
  name: '검증 제품',
  maker: null,
  category: null,
  serving: null,
  per100g: { kcal: 100, carbG: null, proteinG: 5, fatG: null },
  source: {
    type: 'foodqr',
    sourceId: 'source-1',
    url: 'https://example.test/source-1',
    verifiedAt: '2026-08-19',
  },
};

function snapshot(value) {
  return value === undefined
    ? { exists: false, data: () => undefined }
    : { exists: true, data: () => structuredClone(value) };
}

function database(values) {
  const reads = [];
  return {
    reads,
    doc(path) {
      reads.push(path);
      return { get: async () => snapshot(values[path]) };
    },
  };
}

const pointer = {
  runId: 'ready-run',
  recordCount: 1,
  materialSha256: 'a'.repeat(64),
};
const run = { ...pointer, status: 'ready' };

test('queries a canonical UPC through the ready barcode run', async () => {
  const db = database({
    'barcodeCatalogState/current': pointer,
    'barcodeCatalogRuns/ready-run': run,
    'barcodeCatalogRuns/ready-run/foods/0036000291452': record,
  });
  assert.deepEqual(await queryBarcodeCatalog(db, '036000291452'), record);
  assert.deepEqual(db.reads, [
    'barcodeCatalogState/current',
    'barcodeCatalogRuns/ready-run',
    'barcodeCatalogRuns/ready-run/foods/0036000291452',
  ]);
});

test('returns null only for an exact catalog miss', async () => {
  const db = database({
    'barcodeCatalogState/current': pointer,
    'barcodeCatalogRuns/ready-run': run,
  });
  assert.equal(await queryBarcodeCatalog(db, '036000291452'), null);
});

test('refuses invalid input, missing pointers, drifting runs, and malformed records', async () => {
  await assert.rejects(queryBarcodeCatalog(database({}), '036000291452'), /current pointer is missing/);
  await assert.rejects(queryBarcodeCatalog(database({
    'barcodeCatalogState/current': pointer,
    'barcodeCatalogRuns/ready-run': { ...run, materialSha256: 'b'.repeat(64) },
  }), '036000291452'), /ready run does not match current pointer/);
  await assert.rejects(queryBarcodeCatalog(database({
    'barcodeCatalogState/current': pointer,
    'barcodeCatalogRuns/ready-run': run,
    'barcodeCatalogRuns/ready-run/foods/0036000291452': { ...record, raw: 'leak' },
  }), '036000291452'), /unexpected key raw/);
  await assert.rejects(queryBarcodeCatalog(database({}), 'not-a-barcode'), /invalid barcode/);
});
