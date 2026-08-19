import assert from 'node:assert/strict';
import test from 'node:test';

import { createDayPreset, createMealPreset, normalizePreset, planPresetApply } from '../src/lib/presetV2.js';

const entry = {
  foodKey: 'food-a', name: '현미밥', amountG: 210,
  kcal: 300, carbG: 60, proteinG: 6, fatG: 2,
  at: 'old', addedBy: 'search', revisions: [{ changedAt: 'old' }],
};

test('creates meal and day presets without revision history', () => {
  const meal = createMealPreset('점심', 'lunch', [entry], { createdAt: '2026-08-19T00:00:00.000Z' });
  assert.equal(meal.kind, 'meal');
  assert.equal('revisions' in meal.slots.lunch[0], false);

  const day = createDayPreset('기본 하루', { breakfast: [entry], lunch: [], dinner: [], snack: [] }, { createdAt: '2026-08-19T00:00:00.000Z' });
  assert.equal(day.kind, 'day');
  assert.notEqual(day.slots.breakfast[0], entry);
});

test('applies independent preset copies with a new timestamp and preset provenance', () => {
  const preset = createMealPreset('점심', 'lunch', [entry], { createdAt: '2026-08-19T00:00:00.000Z' });
  const current = { breakfast: [], lunch: [], dinner: [], snack: [] };
  const applied = planPresetApply(preset, current, { targetSlot: 'dinner', at: '2026-08-19T03:00:00.000Z' });
  assert.equal(applied.slots.dinner[0].at, '2026-08-19T03:00:00.000Z');
  assert.equal(applied.slots.dinner[0].addedBy, 'preset');
  assert.equal(applied.slots.dinner[0].foodKey, entry.foodKey);
  assert.equal(current.dinner.length, 0);
});

test('normalizes legacy entry and entries presets without mutating them', () => {
  assert.equal(normalizePreset({ label: '하나', entry }).slots.lunch.length, 1);
  assert.equal(normalizePreset({ label: '여럿', entries: [entry] }).slots.lunch.length, 1);
});
