import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeSearchResults } from '../src/lib/searchResults.js';

function food(foodCode, overrides = {}) {
  return {
    foodCode,
    name: `${foodCode} 이름`,
    maker: null,
    foodGroup: 'unknown',
    isFranchise: false,
    marker: `나머지 필드 ${foodCode}`,
    ...overrides,
  };
}

test('빈 결과 배치 목록은 빈 배열로 병합한다', () => {
  assert.deepEqual(mergeSearchResults([]), []);
});

test('빈 배치는 개수와 관계없이 건너뛴다', () => {
  assert.deepEqual(mergeSearchResults([[]]), []);
  assert.deepEqual(mergeSearchResults([[], []]), []);
});

test('배치와 API 내부 순서를 유지하고 뒤 배치의 중복만 버린다', () => {
  const a = food('a');
  const firstB = food('b', { marker: '먼저 받은 원본' });
  const laterB = food('b', { marker: '나중에 받은 중복' });
  const c = food('c');

  const result = mergeSearchResults([[a, firstB], [laterB, c]]);

  assert.deepEqual(result, [a, firstB, c]);
  assert.strictEqual(result[1], firstB);
});

test('같은 항목만 든 두 배치는 첫 항목 하나만 남긴다', () => {
  const first = food('same', { marker: '첫 배치' });
  const duplicate = food('same', { marker: '둘째 배치' });

  assert.deepEqual(mergeSearchResults([[first], [duplicate]]), [first]);
});

test('배치 목록이 배열이 아니면 TypeError를 던진다', () => {
  for (const batches of [null, undefined, 42, {}, 'batch']) {
    assert.throws(() => mergeSearchResults(batches), TypeError);
  }
});

test('배치 목록 안의 원소가 배열이 아니면 TypeError를 던진다', () => {
  for (const batch of [null, undefined, 42, {}, 'batch']) {
    assert.throws(() => mergeSearchResults([batch]), TypeError);
  }
});

test('항목의 foodCode가 없거나 문자열이 아니면 TypeError를 던진다', () => {
  for (const item of [{}, { foodCode: null }, { foodCode: 42 }, { foodCode: [] }]) {
    assert.throws(() => mergeSearchResults([[item]]), TypeError);
  }
});

test('빈 문자열 foodCode를 중복 식별자로 받지 않는다', () => {
  assert.throws(() => mergeSearchResults([[food('')]]), TypeError);
});
