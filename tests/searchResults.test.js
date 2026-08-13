import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeSearchResults, rankSearchResults } from '../src/lib/searchResults.js';

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

test('빈 항목 배열은 빈 새 배열로 반환한다', () => {
  const items = [];
  const result = rankSearchResults(items, '김밥');

  assert.deepEqual(result, []);
  assert.notStrictEqual(result, items);
});

test('빈 검색어는 점수를 계산하지 않고 원본 순서의 복사본을 돌려준다', () => {
  const items = [food('a'), food('b'), food('c')];

  for (const query of ['', '   ']) {
    const result = rankSearchResults(items, query);

    assert.deepEqual(result, items);
    assert.notStrictEqual(result, items);
  }
});

test('앞뒤·연속 공백과 대소문자를 정규화해 정확·시작·포함 순으로 정렬한다', () => {
  const contained = food('contained', { name: '오늘의 BIG MAC 버거' });
  const prefix = food('prefix', { name: 'big mac 세트' });
  const exact = food('exact', { name: '  BIG   MAC  ' });

  assert.deepEqual(rankSearchResults(
    [contained, prefix, exact],
    '  bIg   MaC  ',
  ), [exact, prefix, contained]);
});

test('검색어 토큰이 name에 포함될 때마다 관련도가 높아진다', () => {
  const oneToken = food('one', { name: '매운 음식' });
  const twoTokens = food('two', { name: '김밥 속 매운맛' });

  assert.deepEqual(
    rankSearchResults([oneToken, twoTokens], '매운 김밥'),
    [twoTokens, oneToken],
  );
});

test('maker에 검색어 토큰이 있는 동명 항목을 위로 올린다', () => {
  const withoutMaker = food('plain', { name: '빅맥', maker: null });
  const branded = food('branded', { name: '빅맥', maker: '맥도날드' });

  assert.deepEqual(
    rankSearchResults([withoutMaker, branded], '맥도날드 빅맥'),
    [branded, withoutMaker],
  );
});

test('dish는 ingredient보다 위로 올리고 그룹이 없으면 가점하지 않는다', () => {
  const ingredient = food('ingredient', { name: '김밥 메뉴', foodGroup: 'ingredient' });
  const processed = food('processed', { name: '김밥 메뉴', foodGroup: 'processed' });
  const noGroup = food('no-group', { name: '김밥 메뉴' });
  delete noGroup.foodGroup;
  const dish = food('dish', { name: '김밥 메뉴', foodGroup: 'dish' });

  assert.deepEqual(
    rankSearchResults([ingredient, processed, noGroup, dish], '김밥'),
    [dish, processed, noGroup, ingredient],
  );
});

test('동점인 세 항목의 원래 순서를 유지하고 원본 배열을 변형하지 않는다', () => {
  const first = food('first', { name: '김밥', maker: null, foodGroup: 'processed' });
  const second = food('second', { name: '김밥', maker: '다른회사', foodGroup: 'processed' });
  const third = food('third', { name: '김밥', maker: null, foodGroup: 'processed' });
  const items = [first, second, third];

  const result = rankSearchResults(items, '김밥');

  assert.deepEqual(result, [first, second, third]);
  assert.deepEqual(items, [first, second, third]);
  assert.notStrictEqual(result, items);
});

test('항목 목록이 배열이 아니면 TypeError를 던진다', () => {
  for (const items of [null, undefined, 42, {}, 'items']) {
    assert.throws(() => rankSearchResults(items, '김밥'), TypeError);
  }
});

test('검색어가 문자열이 아니면 TypeError를 던진다', () => {
  for (const query of [null, undefined, 42, {}, []]) {
    assert.throws(() => rankSearchResults([], query), TypeError);
  }
});

test('항목의 name이 없거나 문자열이 아니면 TypeError를 던진다', () => {
  for (const item of [{}, { name: null }, { name: 42 }, { name: [] }]) {
    assert.throws(() => rankSearchResults([item], '김밥'), TypeError);
  }
  assert.throws(() => rankSearchResults([{}], '   '), TypeError);
});
