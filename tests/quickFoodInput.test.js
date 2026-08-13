import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseQuickFoodInput,
  selectBestFood,
} from '../src/lib/quickFoodInput.js';

test('parses an explicit gram amount without marking it estimated', () => {
  assert.deepEqual(parseQuickFoodInput(' 닭가슴살 150g '), {
    ok: true,
    query: '닭가슴살',
    amountG: 150,
    displayAmount: '150g',
    estimated: false,
    servingSource: null,
  });
});

test('converts egg counts with the documented 50g representative weight', () => {
  assert.deepEqual(parseQuickFoodInput('반숙란 2개'), {
    ok: true,
    query: '반숙란',
    amountG: 100,
    displayAmount: '2개',
    estimated: true,
    servingSource: 'mfds-egg-50g',
  });
  assert.equal(parseQuickFoodInput('달걀 두 개').amountG, 100);
  assert.equal(parseQuickFoodInput('계란 반개').amountG, 25);
});

test('converts rice bowl amounts with the documented 200g representative weight', () => {
  assert.deepEqual(parseQuickFoodInput('밥 반 공기'), {
    ok: true,
    query: '밥',
    amountG: 100,
    displayAmount: '반 공기',
    estimated: true,
    servingSource: 'kdca-rice-bowl-200g',
  });
  assert.equal(parseQuickFoodInput('흰쌀밥 1.5공기').amountG, 300);
});

test('returns a searchable query when the serving unit is unsupported', () => {
  assert.deepEqual(parseQuickFoodInput('닭가슴살 한 팩'), {
    ok: false,
    reason: 'unsupported-serving',
    query: '닭가슴살',
  });
});

test('returns the whole query when no amount was supplied', () => {
  assert.deepEqual(parseQuickFoodInput('김치찌개'), {
    ok: false,
    reason: 'quantity-required',
    query: '김치찌개',
  });
});

test('rejects empty, zero, and malformed inputs without inventing an amount', () => {
  assert.deepEqual(parseQuickFoodInput('   '), { ok: false, reason: 'empty', query: '' });
  assert.deepEqual(parseQuickFoodInput('반숙란 0개'), {
    ok: false,
    reason: 'invalid-amount',
    query: '반숙란',
  });
  assert.deepEqual(parseQuickFoodInput('150g'), {
    ok: false,
    reason: 'food-required',
    query: '',
  });
  assert.throws(
    () => parseQuickFoodInput(null),
    new TypeError('parseQuickFoodInput: input must be a string, got null'),
  );
});

test('selectBestFood prefers exact, then prefix, then substring, then first result', () => {
  const foods = [
    { name: '맛있는 반숙란' },
    { name: '반숙란' },
    { name: '반숙란 대란' },
  ];
  assert.equal(selectBestFood('반숙란', foods), foods[1]);

  const withoutExact = [foods[0], foods[2]];
  assert.equal(selectBestFood('반숙란', withoutExact), withoutExact[1]);

  const substringOnly = [{ name: '구운 달걀' }, { name: '촉촉한 반숙란 제품' }];
  assert.equal(selectBestFood('반숙란', substringOnly), substringOnly[1]);

  const noMatch = [{ name: '첫 결과' }, { name: '둘째 결과' }];
  assert.equal(selectBestFood('반숙란', noMatch), noMatch[0]);
  assert.equal(selectBestFood('반숙란', []), null);
});

test('selectBestFood validates its boundary inputs', () => {
  assert.throws(
    () => selectBestFood(null, []),
    new TypeError('selectBestFood: query must be a string, got null'),
  );
  assert.throws(
    () => selectBestFood('반숙란', null),
    new TypeError('selectBestFood: foods must be an array, got null'),
  );
  assert.throws(
    () => selectBestFood('반숙란', [{ code: 'missing-name' }]),
    new TypeError('selectBestFood: foods[0].name must be a string'),
  );
});
