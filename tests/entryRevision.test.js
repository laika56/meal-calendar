import assert from 'node:assert/strict';
import test from 'node:test';

import { revisionReason, reviseEntry } from '../src/lib/entryRevision.js';

const original = Object.freeze({
  foodKey: 'food-a', name: '식품', amountG: 100,
  kcal: 200, carbG: 20, proteinG: 10, fatG: 5,
  addedBy: 'search', at: '2026-08-19T01:00:00.000Z',
  source: 'mfds', estimate: { source: 'category' },
});

test('appends a closed before snapshot while keeping entry identity fields', () => {
  const next = reviseEntry(original, { amountG: 120, kcal: 240 }, {
    reason: 'amount', changedAt: '2026-08-19T02:00:00.000Z',
  });

  assert.equal(next.foodKey, original.foodKey);
  assert.equal(next.addedBy, original.addedBy);
  assert.equal(next.at, original.at);
  assert.equal(next.amountG, 120);
  assert.deepEqual(next.revisions, [{
    changedAt: '2026-08-19T02:00:00.000Z',
    reason: 'amount',
    before: {
      name: '식품', amountG: 100, kcal: 200, carbG: 20, proteinG: 10, fatG: 5,
      estimate: { source: 'category' }, source: 'mfds',
    },
  }]);
  assert.equal('revisions' in original, false);
});

test('rejects invalid reasons and attempts to change immutable identity fields', () => {
  assert.throws(() => reviseEntry(original, {}, { reason: 'other', changedAt: new Date().toISOString() }), /reason/);
  assert.throws(() => reviseEntry(original, { foodKey: 'other' }, { reason: 'identity', changedAt: new Date().toISOString() }), /foodKey/);
});

test('classifies identity, nutrition, and amount edits without guessing', () => {
  assert.equal(revisionReason(original, { ...original, name: '새 이름' }), 'identity');
  assert.equal(revisionReason(original, { ...original, proteinG: 12 }), 'nutrition');
  assert.equal(revisionReason(original, { ...original, amountG: 120 }), 'amount');
  assert.equal(revisionReason(original, { ...original }), null);
});
