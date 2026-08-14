import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseMfdsFoodItem,
  parseMfdsSearchResponse,
  resolveServing,
} from '../src/lib/mfdsParser.js';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/mfds-sample.json', import.meta.url), 'utf8'),
);
const arrayShapeFixture = JSON.parse(
  await readFile(new URL('./fixtures/mfds-search-array-shape.json', import.meta.url), 'utf8'),
);
const brandFixture = JSON.parse(
  await readFile(new URL('./fixtures/mfds-brand-sample.json', import.meta.url), 'utf8'),
);
const [firstItem, secondItem] = fixture.items;
const quantityFields = [
  ['total', 'Z10500', 'totalAmount', 'totalUnit', 'totalNote'],
  ['serving', 'NUTRI_AMOUNT_SERVING', 'servingAmount', 'servingUnit', 'servingNote'],
];

test('parses kcal from all six measured MFDS fixture items', () => {
  assert.equal(fixture.items.length, 6);

  for (const item of fixture.items) {
    assert.equal(parseMfdsFoodItem(item).per100g.kcal, Number(item.AMT_NUM1));
  }
});

test('maps MFDS identity fields and all four per-100g nutrients', () => {
  assert.deepEqual(parseMfdsFoodItem(firstItem), {
    foodCode: 'D101-004160000-0001',
    name: '국밥_돼지머리',
    category: '밥류',
    per100g: {
      kcal: 137,
      proteinG: 6.7,
      fatG: 5.16,
      carbG: 15.94,
    },
    basis: 'g',
    maker: null,
    isFranchise: false,
    foodGroup: 'unknown',
    totalAmount: null,
    totalUnit: null,
    totalNote: null,
    servingAmount: null,
    servingUnit: null,
    servingNote: null,
  });
});

test('normalizes every supported per-100 basis', () => {
  const cases = [
    ['100g', 'g'],
    ['100mL', 'mL'],
    ['100ml', 'mL'],
    [' 100g ', 'g'],
  ];

  for (const [value, expected] of cases) {
    assert.equal(parseMfdsFoodItem({ ...firstItem, SERVING_SIZE: value }).basis, expected);
  }
});

test('rejects every basis that cannot establish a per-100 unit', () => {
  for (const value of ['100', '50g', null, undefined, '', 100, {}, []]) {
    assert.throws(
      () => parseMfdsFoodItem({ ...firstItem, SERVING_SIZE: value }),
      (error) => error.name === 'Error' && error.message.includes(firstItem.FOOD_CD),
    );
  }
});

test('parses measured and comma-grouped nutrient values', () => {
  for (const [value, expected] of [['1,183.000', 1183], ['275.000', 275]]) {
    assert.equal(parseMfdsFoodItem({ ...firstItem, AMT_NUM1: value }).per100g.kcal, expected);
  }
});

test('rejects all four malformed nutrient comma shapes', () => {
  for (const value of ['1,23', '1,,000', ',100', '1,000,']) {
    assert.throws(
      () => parseMfdsFoodItem({ ...firstItem, AMT_NUM1: value }),
      (error) => error.name === 'Error' && error.message.includes(firstItem.FOOD_CD),
    );
  }
});

test('reports a numeric NaN nutrient literally instead of as null', () => {
  assert.throws(
    () => parseMfdsFoodItem({ ...firstItem, AMT_NUM1: Number.NaN }),
    (error) => (
      error.name === 'Error'
      && error.message.includes('NaN')
      && !error.message.includes('got null')
      && error.message.includes(firstItem.FOOD_CD)
    ),
  );
});

for (const [label, field, amountKey, unitKey, noteKey] of quantityFields) {
  test(`maps every specified ${label} amount, unit, and note shape`, () => {
    const cases = [
      ['150ml', 150, 'mL', null],
      ['30g', 30, 'g', null],
      ['1,000.000g', 1000, 'g', null],
      ['100', 100, null, null],
      ['5g(ml)', null, null, '5g(ml)'],
      ['드레싱 15g, 덮밥소스 165g', null, null, '드레싱 15g, 덮밥소스 165g'],
      ['약 200g', null, null, '약 200g'],
      ['  약 200g  ', null, null, '약 200g'],
      ['abc', null, null, 'abc'],
      ['0g', null, null, '0g'],
      ['-5g', null, null, '-5g'],
      ['  150ml  ', 150, 'mL', null],
      [null, null, null, null],
      [undefined, null, null, null],
      ['', null, null, null],
      ['   ', null, null, null],
    ];

    for (const [value, amount, unit, note] of cases) {
      const parsed = parseMfdsFoodItem({ ...firstItem, [field]: value });
      assert.equal(parsed[amountKey], amount, `${field} amount for ${String(value)}`);
      assert.equal(parsed[unitKey], unit, `${field} unit for ${String(value)}`);
      assert.equal(parsed[noteKey], note, `${field} note for ${String(value)}`);
    }
  });
}

test('keeps every previously supported positive amount shape parseable', () => {
  const fields = [
    ['Z10500', 'totalAmount', 'totalUnit', 'totalNote'],
    ['NUTRI_AMOUNT_SERVING', 'servingAmount', 'servingUnit', 'servingNote'],
  ];
  const cases = [
    ['292.000g', 292, 'g'],
    ['35.00g', 35, 'g'],
    ['2,000.000g', 2000, 'g'],
    ['650.000mL', 650, 'mL'],
    ['360.000ml', 360, 'mL'],
    ['  35.00 g ', 35, 'g'],
  ];

  for (const [field, amountKey, unitKey, noteKey] of fields) {
    for (const [value, amount, unit] of cases) {
      const parsed = parseMfdsFoodItem({ ...firstItem, [field]: value });
      assert.equal(parsed[amountKey], amount);
      assert.equal(parsed[unitKey], unit);
      assert.equal(parsed[noteKey], null);
    }
  }
});

for (const [label, field, amountKey, unitKey, noteKey] of quantityFields) {
  test(`preserves all three measured free-text ${label} quantity forms`, () => {
    const values = [
      '5g(ml)',
      '드레싱 15g, 덮밥소스 165g',
      '생·숙면 200g, 건면 100g, 당면 30g, 유탕면(봉지)120g, 유탕면(용기)80g',
    ];

    for (const value of values) {
      const parsed = parseMfdsFoodItem({ ...firstItem, [field]: value });
      assert.equal(parsed[amountKey], null);
      assert.equal(parsed[unitKey], null);
      assert.equal(parsed[noteKey], value);
    }
  });
}

test('keeps a valid item when its serving quantity is free text', () => {
  const parsed = parseMfdsFoodItem({
    ...firstItem,
    NUTRI_AMOUNT_SERVING: '드레싱 15g, 덮밥소스 165g',
  });

  assert.equal(parsed.name, '국밥_돼지머리');
  assert.deepEqual(parsed.per100g, {
    kcal: 137,
    proteinG: 6.7,
    fatG: 5.16,
    carbG: 15.94,
  });
  assert.equal(parsed.basis, 'g');
  assert.equal(parsed.servingAmount, null);
  assert.equal(parsed.servingUnit, null);
  assert.equal(parsed.servingNote, '드레싱 15g, 덮밥소스 165g');
});

for (const [label, field, amountKey, unitKey, noteKey] of quantityFields) {
  test(`preserves malformed comma ${label} amount strings as notes`, () => {
    for (const value of ['1,23g', '1,,000g', ',100g', '1,000,g']) {
      const parsed = parseMfdsFoodItem({ ...firstItem, [field]: value });
      assert.equal(parsed[amountKey], null);
      assert.equal(parsed[unitKey], null);
      assert.equal(parsed[noteKey], value);
    }
  });
}

for (const [quantityLabel, field, amountKey] of quantityFields) {
  test(`rejects every non-string non-null ${quantityLabel} field with TypeError`, () => {
    for (const value of [292, Number.NaN, 1n, {}, []]) {
      assert.throws(
        () => parseMfdsFoodItem({ ...firstItem, [field]: value }),
        (error) => (
          error.name === 'TypeError'
          && error.message.includes(amountKey)
          && error.message.includes(firstItem.FOOD_CD)
        ),
      );
    }
  });
}

test('trims MAKER_NM and maps absent or blank names to null', () => {
  assert.equal(parseMfdsFoodItem({ ...firstItem, MAKER_NM: '맥도날드' }).maker, '맥도날드');
  assert.equal(parseMfdsFoodItem({ ...firstItem, MAKER_NM: '  스타벅스  ' }).maker, '스타벅스');

  for (const value of [null, undefined, '', '   ']) {
    assert.equal(parseMfdsFoodItem({ ...firstItem, MAKER_NM: value }).maker, null);
  }
});

test('rejects every non-string non-null MAKER_NM with TypeError', () => {
  for (const value of [0, {}, [], 1n]) {
    assert.throws(
      () => parseMfdsFoodItem({ ...firstItem, MAKER_NM: value }),
      (error) => error.name === 'TypeError' && error.message.includes(firstItem.FOOD_CD),
    );
  }
});

test('sets isFranchise only from FOOD_OR_CD 2', () => {
  assert.equal(parseMfdsFoodItem({ ...firstItem, FOOD_OR_CD: '2' }).isFranchise, true);

  for (const value of ['1', null, undefined, '', 'unexpected']) {
    assert.equal(parseMfdsFoodItem({ ...firstItem, FOOD_OR_CD: value }).isFranchise, false);
  }

  assert.equal(parseMfdsFoodItem({
    ...firstItem,
    FOOD_OR_CD: '1',
    FOOD_OR_NM: '외식(프랜차이즈 등 업체 제공 영양정보)',
  }).isFranchise, false);
});

test('maps every specified DB_GRP_CM string, absent value, and blank value to foodGroup', () => {
  const cases = [
    ['D', 'dish'],
    ['P', 'processed'],
    ['R1', 'ingredient'],
    ['unexpected', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['', 'unknown'],
  ];

  for (const [value, expected] of cases) {
    assert.equal(parseMfdsFoodItem({ ...firstItem, DB_GRP_CM: value }).foodGroup, expected);
  }
});

test('uses DB_GRP_CM alone instead of inferring foodGroup from DB_GRP_NM', () => {
  assert.equal(parseMfdsFoodItem({
    ...firstItem,
    DB_GRP_CM: 'unexpected',
    DB_GRP_NM: '음식',
  }).foodGroup, 'unknown');
});

test('rejects every non-string non-null DB_GRP_CM with TypeError', () => {
  for (const value of [0, true, 1n, {}, []]) {
    assert.throws(
      () => parseMfdsFoodItem({ ...firstItem, DB_GRP_CM: value }),
      (error) => error.name === 'TypeError' && error.message.includes(firstItem.FOOD_CD),
    );
  }
});

test('parses total amount, basis, maker, franchise, and food group from measured brand items', () => {
  const bigMac = brandFixture.cases.franchise_with_weight.items[1];
  const gimbap = brandFixture.cases.generic_no_maker.items[0];

  assert.deepEqual(
    (({ totalAmount, totalUnit, basis, maker, isFranchise, foodGroup }) => ({
      totalAmount,
      totalUnit,
      basis,
      maker,
      isFranchise,
      foodGroup,
    }))(
      parseMfdsFoodItem({ ...bigMac, DB_GRP_CM: 'D' }),
    ),
    {
      totalAmount: 223,
      totalUnit: 'g',
      basis: 'g',
      maker: '맥도날드',
      isFranchise: true,
      foodGroup: 'dish',
    },
  );
  assert.deepEqual(
    (({ totalAmount, totalUnit, basis, maker, isFranchise, foodGroup }) => ({
      totalAmount,
      totalUnit,
      basis,
      maker,
      isFranchise,
      foodGroup,
    }))(
      parseMfdsFoodItem({ ...gimbap, DB_GRP_CM: 'D' }),
    ),
    {
      totalAmount: 230,
      totalUnit: 'g',
      basis: 'g',
      maker: null,
      isFranchise: false,
      foodGroup: 'dish',
    },
  );
});

test('resolves measured D-group Big Mac and non-franchise gimbap totals as one serving', () => {
  const bigMac = brandFixture.cases.franchise_with_weight.items[1];
  const gimbap = brandFixture.cases.generic_no_maker.items[0];

  assert.deepEqual(resolveServing(parseMfdsFoodItem({ ...bigMac, DB_GRP_CM: 'D' })), {
    amount: 223,
    unit: 'g',
    source: 'dish-total',
  });
  assert.equal(parseMfdsFoodItem({ ...gimbap, DB_GRP_CM: 'D' }).isFranchise, false);
  assert.deepEqual(resolveServing(parseMfdsFoodItem({ ...gimbap, DB_GRP_CM: 'D' })), {
    amount: 230,
    unit: 'g',
    source: 'dish-total',
  });
});

test('rejects measured dish totals that exactly repeat the 100-unit nutrient basis', () => {
  for (const name of ['라멘_미소라멘', '김치찌개_김치만']) {
    assert.equal(resolveServing({
      name,
      foodGroup: 'dish',
      totalAmount: 100,
      totalUnit: 'g',
      basis: 'g',
      servingAmount: null,
      servingUnit: null,
    }), null);
  }
});

test('keeps every specified dish total immediately outside the exact 100 boundary', () => {
  const cases = [
    ['삼각김밥', 94.5, 'mL'],
    ['99.9g 조리음식', 99.9, 'g'],
    ['100.5g 조리음식', 100.5, 'g'],
    ['김밥', 230, 'g'],
    ['버거_빅맥 버거', 223, 'g'],
  ];

  for (const [name, amount, basis] of cases) {
    assert.deepEqual(resolveServing({
      name,
      foodGroup: 'dish',
      totalAmount: amount,
      totalUnit: basis,
      basis,
      servingAmount: null,
      servingUnit: null,
    }), {
      amount,
      unit: basis,
      source: 'dish-total',
    });
  }
});

test('falls through a rejected 100-unit dish total to its separate serving field', () => {
  assert.deepEqual(resolveServing({
    foodGroup: 'dish',
    totalAmount: 100,
    totalUnit: 'g',
    basis: 'g',
    servingAmount: 40,
    servingUnit: 'g',
  }), {
    amount: 40,
    unit: 'g',
    source: 'serving-field',
  });
});

test('keeps processed-product totals and non-dish 100-unit serving fields on their existing paths', () => {
  assert.equal(resolveServing({
    foodGroup: 'processed',
    totalAmount: 100,
    totalUnit: 'g',
    basis: 'g',
    servingAmount: null,
    servingUnit: null,
  }), null);

  for (const foodGroup of ['processed', 'ingredient']) {
    assert.deepEqual(resolveServing({
      foodGroup,
      totalAmount: null,
      totalUnit: null,
      basis: 'g',
      servingAmount: 100,
      servingUnit: 'g',
    }), {
      amount: 100,
      unit: 'g',
      source: 'serving-field',
    });
  }
});

test('prefers a dish total when both total and serving fields are present', () => {
  assert.deepEqual(resolveServing({
    foodGroup: 'dish',
    totalAmount: 500,
    totalUnit: 'g',
    basis: 'g',
    servingAmount: 100,
    servingUnit: 'g',
  }), {
    amount: 500,
    unit: 'g',
    source: 'dish-total',
  });
});

test('falls back to basis when a dish total has no unit', () => {
  assert.deepEqual(resolveServing({
    foodGroup: 'dish',
    totalAmount: 650,
    totalUnit: null,
    basis: 'mL',
    servingAmount: null,
    servingUnit: null,
  }), {
    amount: 650,
    unit: 'mL',
    source: 'dish-total',
  });
});

test('resolves a same-unit serving field for a processed product', () => {
  assert.deepEqual(resolveServing({
    name: '단백질 쉐이크 흑임자',
    foodGroup: 'processed',
    totalAmount: 500,
    totalUnit: 'g',
    basis: 'g',
    servingAmount: 40,
    servingUnit: 'g',
  }), {
    amount: 40,
    unit: 'g',
    source: 'serving-field',
  });
});

test('returns null for the measured WPI serving whose mL unit differs from its g basis', () => {
  assert.equal(resolveServing({
    name: '삼대오백 WPI 웨이프로틴 초코',
    foodGroup: 'processed',
    totalAmount: 1000,
    totalUnit: 'g',
    basis: 'g',
    servingAmount: 150,
    servingUnit: 'mL',
  }), null);
});

test('returns null when a g serving unit differs from an mL basis', () => {
  assert.equal(resolveServing({
    foodGroup: 'processed',
    totalAmount: null,
    totalUnit: null,
    basis: 'mL',
    servingAmount: 30,
    servingUnit: 'g',
  }), null);
});

test('falls back to a same-unit serving when a dish total unit differs from its basis', () => {
  assert.deepEqual(resolveServing({
    foodGroup: 'dish',
    totalAmount: 650,
    totalUnit: 'mL',
    basis: 'g',
    servingAmount: 30,
    servingUnit: 'g',
  }), {
    amount: 30,
    unit: 'g',
    source: 'serving-field',
  });
});

test('falls back to basis when the serving field has no unit', () => {
  assert.deepEqual(resolveServing({
    foodGroup: 'processed',
    totalAmount: null,
    totalUnit: null,
    basis: 'g',
    servingAmount: 100,
    servingUnit: null,
  }), {
    amount: 100,
    unit: 'g',
    source: 'serving-field',
  });
});

test('rejects a dish serving field that exactly repeats the 100-unit nutrient basis', () => {
  for (const servingUnit of [null, 'g']) {
    assert.equal(resolveServing({
      foodGroup: 'dish',
      totalAmount: null,
      totalUnit: null,
      basis: 'g',
      servingAmount: 100,
      servingUnit,
    }), null);
  }
});

test('keeps dish serving fields immediately outside the exact 100 boundary', () => {
  for (const servingAmount of [99, 101]) {
    assert.deepEqual(resolveServing({
      foodGroup: 'dish',
      totalAmount: null,
      totalUnit: null,
      basis: 'g',
      servingAmount,
      servingUnit: 'g',
    }), {
      amount: servingAmount,
      unit: 'g',
      source: 'serving-field',
    });
  }
});

test('returns null for a processed product with only a package total', () => {
  assert.equal(resolveServing({
    foodGroup: 'processed',
    totalAmount: 1000,
    totalUnit: 'g',
    basis: 'g',
    servingAmount: null,
    servingUnit: null,
  }), null);
});

test('returns null for ingredient and unknown food groups without a serving field', () => {
  for (const foodGroup of ['ingredient', 'unknown']) {
    assert.equal(resolveServing({
      foodGroup,
      totalAmount: 230,
      totalUnit: 'g',
      basis: 'g',
      servingAmount: null,
      servingUnit: null,
    }), null);
  }
});

test('does not use the legacy franchise flag as a serving source', () => {
  assert.equal(resolveServing({
    foodGroup: 'unknown',
    isFranchise: true,
    totalAmount: 223,
    totalUnit: 'g',
    basis: 'g',
    servingAmount: null,
    servingUnit: null,
  }), null);
});

test('rejects every non-object resolveServing argument with TypeError', () => {
  for (const value of [null, undefined, 'food', 0, true, 1n]) {
    assert.throws(() => resolveServing(value), TypeError);
  }
});

test('rejects a serving size other than a supported per-100 basis and reports the source value', () => {
  assert.throws(
    () => parseMfdsFoodItem({ ...firstItem, SERVING_SIZE: '1인분(250g)' }),
    (error) => (
      error.name === 'Error'
      && error.message.includes('1인분(250g)')
      && error.message.includes(firstItem.FOOD_CD)
    ),
  );
});

test('maps an empty AMT_NUM1 string to null kcal', () => {
  assert.equal(parseMfdsFoodItem({ ...firstItem, AMT_NUM1: '' }).per100g.kcal, null);
});

test('rejects a non-numeric AMT_NUM3 string and names proteinG', () => {
  assert.throws(
    () => parseMfdsFoodItem({ ...firstItem, AMT_NUM3: 'abc' }),
    {
      name: 'Error',
      message: `parseMfdsFoodItem: proteinG is not a valid number, got "abc" for ${firstItem.FOOD_CD}`,
    },
  );
});

test('rejects a negative AMT_NUM4 string', () => {
  assert.throws(
    () => parseMfdsFoodItem({ ...firstItem, AMT_NUM4: '-1.5' }),
    {
      name: 'Error',
      message: `parseMfdsFoodItem: fatG must not be negative, got "-1.5" for ${firstItem.FOOD_CD}`,
    },
  );
});

test('normalizes a single MFDS response item object to an array', () => {
  const result = parseMfdsSearchResponse({
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { totalCount: 1, items: { item: firstItem } },
  });

  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 1);
  assert.equal(result[0].foodCode, 'D101-004160000-0001');
});

test('keeps an MFDS response item array as an array', () => {
  const result = parseMfdsSearchResponse({
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { totalCount: 2, items: { item: [firstItem, secondItem] } },
  });

  assert.equal(Array.isArray(result), true);
  assert.deepEqual(
    result.map(({ foodCode }) => foodCode),
    ['D101-004160000-0001', 'D101-004310000-0001'],
  );
});

test('parses every item when body.items is an array in a measured MFDS response', () => {
  const result = parseMfdsSearchResponse(arrayShapeFixture);

  assert.deepEqual(
    result.map(({ foodCode }) => foodCode),
    [
      'D102-096060000-0001',
      'D110-462155200-0001',
      'D114-640080000-0001',
      'D202-096060000-0001',
    ],
  );
});

test('keeps a one-item body.items array as an array', () => {
  const result = parseMfdsSearchResponse({
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { totalCount: 1, items: [firstItem] },
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].foodCode, 'D101-004160000-0001');
});

test('returns an empty array when body.items is null', () => {
  assert.deepEqual(parseMfdsSearchResponse({
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { totalCount: 1, items: null },
  }), []);
});

test('rejects a numeric body.items value with the unexpected shape', () => {
  assert.throws(
    () => parseMfdsSearchResponse({
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { totalCount: 1, items: 42 },
    }),
    {
      name: 'TypeError',
      message: 'parseMfdsSearchResponse: unexpected items shape, got 42',
    },
  );
});

test('rejects a string body.items value with the unexpected shape', () => {
  assert.throws(
    () => parseMfdsSearchResponse({
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { totalCount: 1, items: 'unexpected' },
    }),
    {
      name: 'TypeError',
      message: 'parseMfdsSearchResponse: unexpected items shape, got "unexpected"',
    },
  );
});

test('propagates an MFDS API error response', () => {
  assert.throws(
    () => parseMfdsSearchResponse({
      header: { resultCode: '99', resultMsg: 'SYNTHETIC ERROR' },
      body: { totalCount: 0 },
    }),
    {
      name: 'Error',
      message: 'parseMfdsSearchResponse: API error 99 SYNTHETIC ERROR',
    },
  );
});

test('returns an empty array when totalCount is zero', () => {
  assert.deepEqual(parseMfdsSearchResponse({
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { totalCount: 0, items: { item: firstItem } },
  }), []);
});

test('returns an empty array when items is absent', () => {
  assert.deepEqual(parseMfdsSearchResponse({
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: { totalCount: 1 },
  }), []);
});
