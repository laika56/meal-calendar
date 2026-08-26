import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMultiCandidate } from '../src/lib/multiCandidate.js';

// tests/fixtures/mfds-sample.json의 2026-08-13 식약처 실제 응답 중 `김밥` 값이다.
const COMPLETE_PER_100G = {
  kcal: 140,
  carbG: 19.98,
  proteinG: 4.84,
  fatG: 4.55,
};

function makeFood(overrides = {}) {
  return {
    name: '김밥',
    per100g: COMPLETE_PER_100G,
    ...overrides,
  };
}

function makePiece(parsed) {
  return { text: '김밥 입력', parsed };
}

test('rejects empty search results with only text and ok', () => {
  const result = resolveMultiCandidate(
    makePiece({ ok: true, query: '김밥', amountG: 100 }),
    [],
  );

  assert.deepEqual(result, { text: '김밥 입력', ok: false });
  assert.equal('food' in result, false);
});

test('rejects results without a name match instead of using the first food', () => {
  const result = resolveMultiCandidate(
    makePiece({ ok: true, query: '김밥', amountG: 100 }),
    [makeFood({ name: '국밥_돼지머리' })],
  );

  assert.deepEqual(result, { text: '김밥 입력', ok: false });
  assert.equal('food' in result, false);
});

test('uses an already parsed gram amount and preserves its object reference', () => {
  const parsed = { ok: true, query: '김밥', amountG: 150 };
  const food = makeFood();

  const result = resolveMultiCandidate(makePiece(parsed), [food]);

  assert.equal(result.ok, true);
  assert.equal(result.food, food);
  assert.equal(result.amountG, 150);
  assert.equal(result.quickInput, parsed);
  assert.equal(result.kcal, 210);
  assert.equal(result.displayAmount, '150g');
  assert.equal(result.estimated, false);
  assert.equal(result.incomplete, false);
});

test('uses the best name match instead of the first matching search result', () => {
  const qualifiedFood = makeFood({
    name: '김밥_김치',
    per100g: { kcal: 130, carbG: 19.17, proteinG: 4.3, fatG: 4.03 },
  });
  const exactFood = makeFood();

  const result = resolveMultiCandidate(
    makePiece({ ok: true, query: '김밥', amountG: 100 }),
    [qualifiedFood, exactFood],
  );

  assert.equal(result.food, exactFood);
  assert.equal(result.kcal, 140);
});

test('rejects an unparsed count when the matched food has no serving', () => {
  const result = resolveMultiCandidate(
    makePiece({ ok: false, query: '김밥', count: 2 }),
    [makeFood()],
  );

  assert.deepEqual(result, { text: '김밥 입력', ok: false });
  assert.equal('food' in result, false);
});

test('rejects every non-positive or non-finite count without adding result fields', async (t) => {
  const cases = [
    ['zero', 0],
    ['negative', -2],
    ['NaN', NaN],
    ['undefined', undefined],
  ];

  for (const [label, count] of cases) {
    await t.test(label, () => {
      const result = resolveMultiCandidate(
        makePiece({ ok: false, query: '김밥', count }),
        [makeFood({ serving: { amount: 56.25 } })],
      );

      assert.deepEqual(result, { text: '김밥 입력', ok: false });
      assert.equal('food' in result, false);
    });
  }
});

test('converts a valid count with the matched serving and marks the input estimated', () => {
  const parsed = { ok: false, reason: 'unsupported-serving', query: '김밥', count: 2 };

  const result = resolveMultiCandidate(
    makePiece(parsed),
    [makeFood({ serving: { amount: 56.25 } })],
  );

  assert.equal(result.ok, true);
  assert.equal(result.amountG, 112.5);
  assert.equal(result.kcal, 157.5);
  assert.equal(result.displayAmount, '2개');
  assert.equal(result.estimated, true);
  assert.deepEqual(result.quickInput, {
    ...parsed,
    ok: true,
    amountG: 112.5,
    displayAmount: '2개',
    estimated: true,
    servingSource: 'mfds-serving',
  });
});

test('does not round a fractional serving amount produced from a count', () => {
  const result = resolveMultiCandidate(
    makePiece({ ok: false, query: '김밥', count: 2 }),
    [makeFood({ serving: { amount: 56.25 } })],
  );

  assert.equal(result.amountG, 112.5);
});

test('marks scaled nutrients incomplete when any per-100g value is null', () => {
  const result = resolveMultiCandidate(
    makePiece({ ok: true, query: '김밥', amountG: 100 }),
    [makeFood({ per100g: { ...COMPLETE_PER_100G, fatG: null } })],
  );

  assert.equal(result.incomplete, true);
});

test('keeps an empty quick-input query as the successful result name', () => {
  const result = resolveMultiCandidate(
    makePiece({ ok: true, query: '', amountG: 100 }),
    [makeFood()],
  );

  assert.equal(result.name, '');
});
