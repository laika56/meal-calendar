import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseQuickFoodInput,
  splitQuickFoodInput,
  selectBestFood,
  hasNameMatch,
} from '../src/lib/quickFoodInput.js';

test('splits comma-separated quick input with or without whitespace after the comma', () => {
  assert.deepEqual(
    splitQuickFoodInput('반숙란 2개, 단백질쉐이크 1스쿱').map(({ text }) => text),
    ['반숙란 2개', '단백질쉐이크 1스쿱'],
  );
  assert.deepEqual(
    splitQuickFoodInput('밥 한 공기,김치 100g').map(({ text }) => text),
    ['밥 한 공기', '김치 100g'],
  );
});

test('splits newline-separated quick input', () => {
  assert.deepEqual(
    splitQuickFoodInput('반숙란 2개\n우유 200g').map(({ text }) => text),
    ['반숙란 2개', '우유 200g'],
  );
});

test('returns one normalized item when there is no separator', () => {
  assert.deepEqual(splitQuickFoodInput('  반숙란   2개  '), [
    {
      text: '반숙란 2개',
      parsed: {
        ok: true,
        query: '반숙란',
        amountG: 100,
        displayAmount: '2개',
        estimated: true,
        servingSource: 'mfds-egg-50g',
      },
    },
  ]);
});

test('drops empty comma fragments including whitespace-only fragments', () => {
  assert.deepEqual(
    splitQuickFoodInput('반숙란 2개,,우유 200g').map(({ text }) => text),
    ['반숙란 2개', '우유 200g'],
  );
  assert.deepEqual(
    splitQuickFoodInput('반숙란 2개, , 우유 200g').map(({ text }) => text),
    ['반숙란 2개', '우유 200g'],
  );
});

test('returns no items for zero fragments, commas only, empty, or whitespace-only input', () => {
  assert.deepEqual(splitQuickFoodInput('  , ,  '), []);
  assert.deepEqual(splitQuickFoodInput(''), []);
  assert.deepEqual(splitQuickFoodInput('   '), []);
});

test('keeps plus signs, Korean particles, and spaces inside a single food fragment', () => {
  assert.deepEqual(splitQuickFoodInput('비타민B+C 10g').map(({ text }) => text), ['비타민B+C 10g']);
  assert.deepEqual(splitQuickFoodInput('김치와 두부 100g').map(({ text }) => text), ['김치와 두부 100g']);
  assert.deepEqual(
    splitQuickFoodInput('반숙란 2개 우유 200g').map(({ text }) => text),
    ['반숙란 2개 우유 200g'],
  );
});

test('normalizes each fragment and supports mixed newlines and commas', () => {
  assert.deepEqual(
    splitQuickFoodInput('  반숙란   2개,\n  우유\t200g\n, 밥  한 공기  ').map(({ text }) => text),
    ['반숙란 2개', '우유 200g', '밥 한 공기'],
  );
});

test('keeps a failed parsed fragment alongside a successful fragment without alteration', () => {
  assert.deepEqual(splitQuickFoodInput('반숙란 2개, 이상한거'), [
    {
      text: '반숙란 2개',
      parsed: {
        ok: true,
        query: '반숙란',
        amountG: 100,
        displayAmount: '2개',
        estimated: true,
        servingSource: 'mfds-egg-50g',
      },
    },
    {
      text: '이상한거',
      parsed: { ok: false, reason: 'quantity-required', query: '이상한거' },
    },
  ]);
});

test('keeps ten fragments and truncates an eleventh fragment', () => {
  const elevenFragments = [
    '음식 1g', '음식 2g', '음식 3g', '음식 4g', '음식 5g', '음식 6g',
    '음식 7g', '음식 8g', '음식 9g', '음식 10g', '음식 11g',
  ];

  assert.deepEqual(
    splitQuickFoodInput(elevenFragments.slice(0, 10).join(',')).map(({ text }) => text),
    elevenFragments.slice(0, 10),
  );
  assert.deepEqual(
    splitQuickFoodInput(elevenFragments.join(',')).map(({ text }) => text),
    elevenFragments.slice(0, 10),
  );
});

test('rejects every specified non-string input with TypeError', () => {
  for (const input of [null, 42, [], {}]) {
    assert.throws(() => splitQuickFoodInput(input), TypeError);
  }
});

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

test('keeps every specified count and original unit for unsupported servings', () => {
  const cases = [
    ['김밥 1개', '김밥', 1, '개'],
    ['빅맥 2개', '빅맥', 2, '개'],
    ['만두 1.5개', '만두', 1.5, '개'],
    ['라면 한 개', '라면', 1, '개'],
    ['만두 두 개', '만두', 2, '개'],
    ['피자 세 개', '피자', 3, '개'],
    ['치킨 네 개', '치킨', 4, '개'],
    ['케이크 반 개', '케이크', 0.5, '개'],
    ['국 한 공기', '국', 1, '공기'],
    ['고기 2팩', '고기', 2, '팩'],
    ['견과 2봉', '견과', 2, '봉'],
    ['과자 3봉지', '과자', 3, '봉지'],
  ];

  for (const [input, query, count, unit] of cases) {
    assert.deepEqual(parseQuickFoodInput(input), {
      ok: false,
      reason: 'unsupported-serving',
      query,
      count,
      unit,
    });
  }
});

test('does not expose count or unit when the amount could not be read', () => {
  const cases = [
    ['   ', 'empty'],
    ['150g', 'food-required'],
    ['반숙란 0개', 'invalid-amount'],
    ['김치찌개', 'quantity-required'],
  ];

  for (const [input, reason] of cases) {
    const result = parseQuickFoodInput(input);
    assert.equal(result.reason, reason);
    assert.strictEqual(result.count, undefined);
    assert.strictEqual(result.unit, undefined);
  }
});

test('keeps successful quick-input return objects unchanged', () => {
  assert.deepEqual(parseQuickFoodInput('반숙란 2개'), {
    ok: true,
    query: '반숙란',
    amountG: 100,
    displayAmount: '2개',
    estimated: true,
    servingSource: 'mfds-egg-50g',
  });
  assert.deepEqual(parseQuickFoodInput('밥 한 공기'), {
    ok: true,
    query: '밥',
    amountG: 200,
    displayAmount: '한 공기',
    estimated: true,
    servingSource: 'kdca-rice-bowl-200g',
  });
  assert.deepEqual(parseQuickFoodInput('우유 200g'), {
    ok: true,
    query: '우유',
    amountG: 200,
    displayAmount: '200g',
    estimated: false,
    servingSource: null,
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

// 리뷰 I4: JSON.stringify(NaN) 은 'null' 을 돌려준다. NaN 을 넘겼는데 오류가 null 이라고
// 말하면 디버깅할 때 값의 출처를 완전히 잘못 짚는다 — 리터럴 문자열 'NaN' 이어야 한다.
test('reports NaN literally instead of JSON.stringify\'s misleading "null"', () => {
  assert.throws(
    () => parseQuickFoodInput(NaN),
    new TypeError('parseQuickFoodInput: input must be a string, got NaN'),
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
  assert.throws(
    () => selectBestFood(NaN, []),
    new TypeError('selectBestFood: query must be a string, got NaN'),
  );
});

// 리뷰 I5: selectBestFood 가 foods[0] 폴백으로 떨어지면(= 이름이 전혀 안 맞으면) 호출부는
// 그 결과를 확인 없이 바로 기록하면 안 된다. hasNameMatch 가 "진짜 매칭이 있었는지"를 구분해준다.
test('hasNameMatch is true only when a real match (not the [0] fallback) exists', () => {
  const foods = [
    { name: '맛있는 반숙란' },
    { name: '반숙란' },
    { name: '반숙란 대란' },
  ];
  assert.equal(hasNameMatch('반숙란', foods), true); // 정확 일치가 있다

  const substringOnly = [{ name: '구운 달걀' }, { name: '촉촉한 반숙란 제품' }];
  assert.equal(hasNameMatch('반숙란', substringOnly), true); // 부분문자열 일치가 있다

  const noMatch = [{ name: '첫 결과' }, { name: '둘째 결과' }];
  assert.equal(hasNameMatch('반숙란', noMatch), false); // selectBestFood 라면 foods[0] 폴백
  assert.equal(hasNameMatch('반숙란', []), false);
});

test('hasNameMatch validates its boundary inputs the same way selectBestFood does', () => {
  assert.throws(
    () => hasNameMatch(null, []),
    new TypeError('hasNameMatch: query must be a string, got null'),
  );
  assert.throws(
    () => hasNameMatch('반숙란', null),
    new TypeError('hasNameMatch: foods must be an array, got null'),
  );
  assert.throws(
    () => hasNameMatch('반숙란', [{ code: 'missing-name' }]),
    new TypeError('hasNameMatch: foods[0].name must be a string'),
  );
});
