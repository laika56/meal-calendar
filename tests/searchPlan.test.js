import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSearchPlan } from '../src/lib/searchPlan.js';

test('plans a one-token query by food name before maker name', () => {
  assert.deepEqual(buildSearchPlan('김밥'), [
    { FOOD_NM_KR: '김밥' },
    { MAKER_NM: '김밥' },
  ]);
});

test('trims and collapses whitespace before building the plan', () => {
  assert.deepEqual(buildSearchPlan('  김밥  '), buildSearchPlan('김밥'));
  assert.deepEqual(buildSearchPlan('서가원   김밥'), buildSearchPlan('서가원 김밥'));
});

test('plans a two-token query in exact, combined, maker, then food order', () => {
  assert.deepEqual(buildSearchPlan('서가원 김밥'), [
    { FOOD_NM_KR: '서가원 김밥' },
    { MAKER_NM: '서가원', FOOD_NM_KR: '김밥' },
    { MAKER_NM: '서가원' },
    { FOOD_NM_KR: '김밥' },
  ]);
});

test('keeps every remaining token together as the food name', () => {
  assert.deepEqual(buildSearchPlan('서브웨이 이탈리안 BMT'), [
    { FOOD_NM_KR: '서브웨이 이탈리안 BMT' },
    { MAKER_NM: '서브웨이', FOOD_NM_KR: '이탈리안 BMT' },
    { MAKER_NM: '서브웨이' },
    { FOOD_NM_KR: '이탈리안 BMT' },
  ]);
});

test('returns an empty plan while the search input is empty', () => {
  assert.deepEqual(buildSearchPlan(''), []);
  assert.deepEqual(buildSearchPlan('   '), []);
});

test('rejects every specified non-string query type with TypeError', () => {
  for (const query of [null, undefined, 42, {}, []]) {
    assert.throws(() => buildSearchPlan(query), TypeError);
  }
});

test('keeps a five-token query to at most the first four unique plans', () => {
  const result = buildSearchPlan('하나 둘 셋 넷 다섯');

  assert.deepEqual(result, [
    { FOOD_NM_KR: '하나 둘 셋 넷 다섯' },
    { MAKER_NM: '하나', FOOD_NM_KR: '둘 셋 넷 다섯' },
    { MAKER_NM: '하나' },
    { FOOD_NM_KR: '둘 셋 넷 다섯' },
  ]);
  assert.equal(result.length, 4);
});

test('does not emit a duplicate key-value combination', () => {
  const result = buildSearchPlan('김밥 김밥');
  const serialized = result.map((entry) => JSON.stringify(entry));

  assert.equal(new Set(serialized).size, result.length);
  assert.ok(result.length <= 4);
  for (const entry of result) {
    assert.ok(Object.keys(entry).every((key) => ['FOOD_NM_KR', 'MAKER_NM'].includes(key)));
  }
});
