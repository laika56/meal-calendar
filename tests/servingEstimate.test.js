import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { estimateServingFromCategory } from '../src/lib/servingEstimate.js';

const TABLE = {
  categories: {
    '면 및 만두류': {
      g: {
        median: 700,
        sampleCount: 75,
        min: 220,
        max: 2292,
        p25: 480.5,
        p75: 852.5,
      },
    },
    양단위류: {
      g: {
        median: 700,
        sampleCount: 75,
        min: 220,
        max: 2292,
        p25: 480.5,
        p75: 852.5,
      },
      mL: {
        median: 200,
        sampleCount: 40,
        min: 100,
        max: 500,
        p25: 150,
        p75: 250,
      },
    },
    음료류: {
      mL: {
        median: 200,
        sampleCount: 40,
        min: 100,
        max: 500,
        p25: 150,
        p75: 250,
      },
    },
  },
};

test('estimateServingFromCategory returns the matching category statistics without rounding', () => {
  assert.deepEqual(
    estimateServingFromCategory({ category: '면 및 만두류', basis: 'g' }, TABLE),
    {
      amount: 700,
      unit: 'g',
      source: 'category-median',
      category: '면 및 만두류',
      sampleCount: 75,
      min: 220,
      max: 2292,
      p25: 480.5,
      p75: 852.5,
    },
  );
});

test('estimateServingFromCategory selects only the statistics matching parsed.basis', () => {
  assert.deepEqual(
    estimateServingFromCategory({ category: '양단위류', basis: 'mL' }, TABLE),
    {
      amount: 200,
      unit: 'mL',
      source: 'category-median',
      category: '양단위류',
      sampleCount: 40,
      min: 100,
      max: 500,
      p25: 150,
      p75: 250,
    },
  );
});

test('estimateServingFromCategory returns null when only a different unit exists', () => {
  assert.equal(
    estimateServingFromCategory({ category: '음료류', basis: 'g' }, TABLE),
    null,
  );
});

test('estimateServingFromCategory returns null for a category absent from the table', () => {
  assert.equal(
    estimateServingFromCategory({ category: '없는 분류', basis: 'g' }, TABLE),
    null,
  );
});

test('estimateServingFromCategory returns null when parsed.category has no value', () => {
  for (const category of [null, '']) {
    assert.equal(
      estimateServingFromCategory({ category, basis: 'g' }, TABLE),
      null,
    );
  }
});

test('estimateServingFromCategory returns null when table.categories is empty', () => {
  assert.equal(
    estimateServingFromCategory({ category: '면 및 만두류', basis: 'g' }, { categories: {} }),
    null,
  );
});

test('estimateServingFromCategory rejects parsed values that are not plain objects', () => {
  const cases = [
    [null, 'null'],
    [[], '[]'],
    ['food', '"food"'],
  ];

  for (const [parsed, formatted] of cases) {
    assert.throws(
      () => estimateServingFromCategory(parsed, TABLE),
      {
        name: 'TypeError',
        message: `estimateServingFromCategory: parsed must be an object, got ${formatted}`,
      },
    );
  }
});

test('estimateServingFromCategory rejects tables without an object categories map', () => {
  const cases = [
    [null, 'null'],
    [{}, 'undefined'],
    [{ categories: [] }, '[]'],
  ];

  for (const [table, formatted] of cases) {
    assert.throws(
      () => estimateServingFromCategory({ category: '면 및 만두류', basis: 'g' }, table),
      {
        name: 'TypeError',
        message: `estimateServingFromCategory: table.categories must be an object, got ${formatted}`,
      },
    );
  }
});

test('estimateServingFromCategory rejects unsupported basis values and preserves NaN in messages', () => {
  const cases = [
    ['kg', '"kg"'],
    [null, 'null'],
    [1, '1'],
    [NaN, 'NaN'],
  ];

  for (const [basis, formatted] of cases) {
    assert.throws(
      () => estimateServingFromCategory({ category: '면 및 만두류', basis }, TABLE),
      {
        name: 'TypeError',
        message: `estimateServingFromCategory: parsed.basis must be "g" or "mL", got ${formatted}`,
      },
    );
  }
});

test('estimateServingFromCategory finds a positive gram estimate in the generated table', () => {
  const generatedTable = JSON.parse(
    readFileSync(new URL('../src/data/servingByCategory.json', import.meta.url), 'utf8'),
  );

  const estimate = estimateServingFromCategory(
    { category: '면 및 만두류', basis: 'g' },
    generatedTable,
  );

  assert.notEqual(estimate, null);
  assert.ok(estimate.amount > 0);
});
