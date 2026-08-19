import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExportEnvelope, planMergeRestore, serializeDaysCsv,
  serializeExportJson, validateExportEnvelope,
} from '../src/lib/dataTransfer.js';

const data = {
  profile: { nickname: '나' }, goals: [{ effectiveFrom: '2026-08-01', kcal: 1900 }],
  days: [{ date: '2026-08-19', slots: { breakfast: [], lunch: [], dinner: [], snack: [] }, totals: { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 } }],
  presets: [{ id: 'preset-a', label: 'A', entry: { name: 'a' } }], dislikes: ['오이'], recentEntries: [],
};

test('builds a versioned canonical JSON envelope without OCR artifacts', () => {
  const envelope = buildExportEnvelope(data, { exportedAt: '2026-08-19T00:00:00.000Z' });
  assert.equal(envelope.schema, 'meal-calendar-export');
  assert.equal(envelope.version, 1);
  assert.equal(serializeExportJson(envelope), `${JSON.stringify(envelope, null, 2)}\n`);
  assert.equal(serializeExportJson(envelope).includes('ocrText'), false);
  assert.deepEqual(validateExportEnvelope(envelope), envelope);
});

test('rejects unknown root fields and duplicate document ids before restore', () => {
  const envelope = buildExportEnvelope(data, { exportedAt: '2026-08-19T00:00:00.000Z' });
  assert.throws(() => validateExportEnvelope({ ...envelope, unknown: true }), /unknown/);
  assert.throws(() => validateExportEnvelope({ ...envelope, days: [...envelope.days, envelope.days[0]] }), /duplicate day/);
});

test('rejects unknown nested fields and invalid nutrition numbers before any restore write', () => {
  const envelope = buildExportEnvelope(data, { exportedAt: '2026-08-19T00:00:00.000Z' });
  assert.throws(() => validateExportEnvelope({
    ...envelope,
    days: [{ ...envelope.days[0], hidden: 'unexpected' }],
  }), /unknown day field/);
  assert.throws(() => validateExportEnvelope({
    ...envelope,
    days: [{
      ...envelope.days[0],
      slots: { ...envelope.days[0].slots, lunch: [{
        foodKey: 'food-a', name: '밥', amountG: 100, kcal: -1,
        carbG: 20, proteinG: 2, fatG: 1, addedBy: 'manual', at: '2026-08-19T00:00:00.000Z',
      }] },
    }],
  }), /kcal must be a valid number/);
  assert.throws(() => validateExportEnvelope({ ...envelope, dislikes: ['ok', 3] }), /dislike/);
});

test('plans merge-only restore and reports existing conflicts', () => {
  assert.deepEqual(planMergeRestore(
    { days: [{ date: '2026-08-19' }], presets: [{ id: 'preset-a' }] },
    { days: [{ date: '2026-08-18' }, { date: '2026-08-19' }], presets: [{ id: 'preset-a' }, { id: 'preset-b' }] },
  ), {
    daysToWrite: ['2026-08-18'], presetsToWrite: ['preset-b'],
    dayConflicts: ['2026-08-19'], presetConflicts: ['preset-a'],
  });
});

test('serializes read-only CSV with escaping and nullable nutrients', () => {
  const csv = serializeDaysCsv([{ date: '2026-08-19', slots: { lunch: [{ name: '밥,김치', amountG: 210, kcal: 300, carbG: null, proteinG: 6, fatG: 2, addedBy: 'search', estimate: true }] } }]);
  assert.match(csv, /"밥,김치"/);
  assert.match(csv, /2026-08-19,lunch/);
  assert.doesNotMatch(csv, /undefined|null/);
});
