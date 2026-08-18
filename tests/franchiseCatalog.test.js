import assert from 'node:assert/strict';
import test from 'node:test';

import * as catalog from '../src/lib/franchiseCatalog.js';

const { normalizeCatalogText, validateCatalogRecord } = catalog;

const subwayBmtFixture = {
  id: 'official_subway_1528',
  brandId: 'subway',
  brandName: '써브웨이',
  name: '이탈리안 비엠티',
  aliases: ['italian bmt', '이탈리안 비엠티'],
  normalizedName: '이탈리안 비엠티',
  searchTokens: ['bmt', 'italian', 'subway', '써브웨이', '서브웨이', '이탈리안', '비엠티'],
  category: '샌드위치',
  basis: { amount: 228, unit: 'g', label: '1인분' },
  nutrients: {
    kcal: 388,
    carbG: null,
    proteinG: 21,
    fatG: null,
    sugarG: 8.6,
    sodiumMg: 1064,
  },
  sourceId: 'subway-menu-1528',
  sourceType: 'official_brand',
  sourceUrl: 'https://www.subway.co.kr/menuView/sandwich?menuItemIdx=1528',
  sourceUpdatedAt: null,
  verifiedAt: '2026-08-18T00:00:00.000Z',
  confidence: 'official',
  active: true,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

function withNutrient(record, nutrient, value) {
  return {
    ...record,
    nutrients: { ...record.nutrients, [nutrient]: value },
  };
}

test('normalizes Subway aliases without erasing Korean identity', () => {
  assert.equal(normalizeCatalogText('  서브웨이  Italian B.M.T.™ '), '서브웨이 italian bmt');
});

test('preserves missing nutrients as null and rejects invented or invalid numbers', () => {
  const record = validateCatalogRecord(subwayBmtFixture);

  assert.equal(record.nutrients.kcal, 388);
  assert.equal(record.nutrients.carbG, null);
  assert.throws(
    () => validateCatalogRecord(withNutrient(subwayBmtFixture, 'fatG', -1)),
    /fatG must be null or a finite non-negative number/,
  );
});

test('returns a deep-frozen clone and refuses unknown fields', () => {
  const record = validateCatalogRecord(subwayBmtFixture);

  assert.notStrictEqual(record, subwayBmtFixture);
  assert.notStrictEqual(record.nutrients, subwayBmtFixture.nutrients);
  assert.throws(() => { record.nutrients.kcal = 0; }, TypeError);
  assert.equal(record.nutrients.kcal, 388);
  assert.throws(
    () => validateCatalogRecord({ ...subwayBmtFixture, unreviewedValue: 1 }),
    /unknown key unreviewedValue/,
  );
});

test('refuses non-canonical aliases, duplicate search tokens, malformed dates, URLs, and units', () => {
  const cases = [
    [{ ...subwayBmtFixture, aliases: ['Italian B.M.T.'] }, /aliases\[0\] must be canonical/],
    [{ ...subwayBmtFixture, searchTokens: ['bmt', 'B.M.T.'] }, /searchTokens contains duplicate normalized token bmt/],
    [{ ...subwayBmtFixture, verifiedAt: '2026-02-30T00:00:00.000Z' }, /verifiedAt must be an ISO UTC date/],
    [{ ...subwayBmtFixture, sourceUrl: 'not a url' }, /sourceUrl must be an absolute http or https URL/],
    [{ ...subwayBmtFixture, basis: { ...subwayBmtFixture.basis, unit: 'oz' } }, /basis.unit must be one of/],
  ];

  for (const [record, message] of cases) {
    assert.throws(() => validateCatalogRecord(record), message);
  }
});

test('adapts the same canonical BMT search result for both Subway spellings', () => {
  const searchFood = catalog.catalogRecordToSearchFood(subwayBmtFixture);

  assert.deepEqual(
    catalog.mergeCatalogAndMfdsResults([searchFood], [], '써브웨이'),
    [searchFood],
  );
  assert.deepEqual(
    catalog.mergeCatalogAndMfdsResults([searchFood], [], '서브웨이'),
    [searchFood],
  );
});

test('converts mass-basis nutrients exactly to compatibility per100g while retaining nulls', () => {
  const searchFood = catalog.catalogRecordToSearchFood(subwayBmtFixture);

  assert.deepEqual(searchFood.per100g, {
    kcal: (388 * 100) / 228,
    carbG: null,
    proteinG: (21 * 100) / 228,
    fatG: null,
  });
  assert.equal(searchFood.basis, 'g');
  assert.equal(searchFood.completeness, 'partial');
  assert.deepEqual(searchFood.serving, { amount: 228, unit: 'g', source: 'official-serving' });
  assert.deepEqual(searchFood.source, {
    type: 'official_brand',
    label: '공식값',
    url: 'https://www.subway.co.kr/menuView/sandwich?menuItemIdx=1528',
    verifiedAt: '2026-08-18T00:00:00.000Z',
  });
});

test('keeps a non-mass official serving in its original values rather than converting it to grams', () => {
  const record = {
    ...subwayBmtFixture,
    id: 'official_subway_cookie',
    name: '쿠키',
    aliases: ['cookie', '쿠키'],
    normalizedName: '쿠키',
    searchTokens: ['cookie', 'subway', '써브웨이', '서브웨이', '쿠키'],
    basis: { amount: 1, unit: '개', label: '1개' },
  };

  const searchFood = catalog.catalogRecordToSearchFood(record);

  assert.equal(searchFood.per100g.kcal, 388);
  assert.equal(searchFood.per100g.proteinG, 21);
  assert.equal(searchFood.basis, 'g');
  assert.deepEqual(searchFood.serving, { amount: 1, unit: '개', source: 'official-serving' });
});

test('deduplicates matching official and public servings, keeps distinct sizes, and does not mutate inputs', () => {
  const official = catalog.catalogRecordToSearchFood(subwayBmtFixture);
  const publicDuplicate = {
    foodKey: 'mfds_subway_1528',
    name: '이탈리안 비엠티',
    category: '샌드위치',
    maker: '써브웨이',
    isFranchise: true,
    per100g: { kcal: 170, carbG: null, proteinG: 9, fatG: null },
    basis: 'g',
    serving: { amount: 228, unit: 'g', source: 'serving-field' },
    source: { type: 'public_data', label: '공공데이터', url: 'https://example.test/mfds', verifiedAt: '2026-08-18T00:00:00.000Z' },
  };
  const differentSize = {
    ...publicDuplicate,
    foodKey: 'mfds_subway_1528_large',
    serving: { amount: 230, unit: 'g', source: 'serving-field' },
  };
  const catalogItems = [official];
  const mfdsItems = [differentSize, publicDuplicate];
  const catalogBefore = structuredClone(catalogItems);
  const mfdsBefore = structuredClone(mfdsItems);

  const result = catalog.mergeCatalogAndMfdsResults(catalogItems, mfdsItems, '이탈리안 비엠티');

  assert.deepEqual(result, [official, differentSize]);
  assert.deepEqual(catalogItems, catalogBefore);
  assert.deepEqual(mfdsItems, mfdsBefore);
});

test('orders equal-relevance merged results deterministically by source priority and food key', () => {
  const official = catalog.catalogRecordToSearchFood(subwayBmtFixture);
  const firstPublic = {
    foodKey: 'mfds_a',
    name: '이탈리안 비엠티',
    maker: '다른 브랜드',
    basis: 'g',
    serving: { amount: 228, unit: 'g', source: 'serving-field' },
    source: { type: 'public_data', label: '공공데이터', url: 'https://example.test/a', verifiedAt: '2026-08-18T00:00:00.000Z' },
  };
  const secondPublic = {
    ...firstPublic,
    foodKey: 'mfds_b',
    serving: { amount: 229, unit: 'g', source: 'serving-field' },
  };

  assert.deepEqual(
    catalog.mergeCatalogAndMfdsResults([official], [secondPublic, firstPublic], '이탈리안 비엠티'),
    [official, firstPublic, secondPublic],
  );
});
