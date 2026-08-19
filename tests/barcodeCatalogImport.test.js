import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  buildBarcodeImportPlan,
  verifyBarcodeImportPlan,
} from '../functions/import-barcode-catalog.mjs';

function record(barcode) {
  return {
    barcode,
    name: `제품 ${barcode}`,
    maker: null,
    category: null,
    serving: null,
    per100g: { kcal: 100, carbG: null, proteinG: null, fatG: null },
    source: {
      type: 'foodqr', sourceId: barcode, url: `https://example.test/${barcode}`, verifiedAt: '2026-08-19',
    },
  };
}

function artifact(records) {
  return {
    records,
    manifest: {
      schemaVersion: 1,
      recordCount: records.length,
      materialSha256: createHash('sha256')
        .update(`${records.map((value) => JSON.stringify(value)).join('\n')}\n`)
        .digest('hex'),
    },
  };
}

test('builds deterministic exact paths with 400-write batches', () => {
  const records = Array.from({ length: 401 }, (_, index) => record(
    index === 0 ? '00000000' : String(index).padStart(7, '0') + String((10 - ([...String(index).padStart(7, '0')].reverse().reduce((sum, digit, offset) => sum + Number(digit) * (offset % 2 === 0 ? 3 : 1), 0) % 10)) % 10),
  )).toSorted((a, b) => a.barcode.localeCompare(b.barcode));
  const sourceArtifact = artifact(records);
  const first = buildBarcodeImportPlan(null, sourceArtifact, 'run-1');
  const second = buildBarcodeImportPlan(null, sourceArtifact, 'run-1');
  assert.deepEqual(first, second);
  assert.deepEqual(first.batches.map((batch) => batch.length), [400, 1]);
  assert.equal(first.documents[0].path, `barcodeCatalogRuns/run-1/foods/${records[0].barcode}`);
  assert.equal(verifyBarcodeImportPlan(first, sourceArtifact), true);
});

test('refuses duplicate paths, malformed artifact drift, and pointer mismatch', () => {
  const one = record('96385074');
  const sourceArtifact = artifact([one]);
  const plan = buildBarcodeImportPlan(null, sourceArtifact, 'run-1');
  assert.throws(() => verifyBarcodeImportPlan({
    ...plan,
    documents: [...plan.documents, plan.documents[0]],
  }, sourceArtifact), /duplicate document path/);
  assert.throws(() => verifyBarcodeImportPlan(plan, {
    ...sourceArtifact,
    records: [{ ...one, name: '변조' }],
  }), /materialSha256|artifact payload mismatch/);
  assert.throws(() => buildBarcodeImportPlan({ runId: 'other' }, sourceArtifact, ''), /runId/);
});

test('makes an exact ready pointer a no-op instead of reopening the published run', () => {
  const sourceArtifact = artifact([record('96385074')]);
  const first = buildBarcodeImportPlan(null, sourceArtifact, 'run-1');
  const pointer = {
    runId: first.runId,
    recordCount: first.run.data.recordCount,
    materialSha256: first.run.data.materialSha256,
    payloadSha256: first.payloadSha256,
    publishedAt: '2026-08-19T00:00:00.000Z',
  };
  const repeated = buildBarcodeImportPlan(pointer, sourceArtifact, 'run-1');
  assert.equal(repeated.unchanged, true);
  assert.deepEqual(repeated.batches, []);
});
