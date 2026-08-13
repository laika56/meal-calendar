import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseMfdsFoodItem,
  parseMfdsSearchResponse,
} from '../src/lib/mfdsParser.js';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/mfds-sample.json', import.meta.url), 'utf8'),
);
const [firstItem, secondItem] = fixture.items;

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
  });
});

test('rejects a serving size other than exactly 100g and reports the source value', () => {
  assert.throws(
    () => parseMfdsFoodItem({ ...firstItem, SERVING_SIZE: '1인분(250g)' }),
    {
      name: 'Error',
      message: `parseMfdsFoodItem: expected SERVING_SIZE "100g", got "1인분(250g)" for ${firstItem.FOOD_CD}`,
    },
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
