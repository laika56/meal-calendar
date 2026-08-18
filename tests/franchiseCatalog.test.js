import assert from 'node:assert/strict';
import test from 'node:test';

import * as catalog from '../src/lib/franchiseCatalog.js';

const { normalizeCatalogText, queryCatalogFoods, validateCatalogRecord } = catalog;

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

function snapshot(data, exists = true) {
  return { exists, data: () => data };
}

function readyCatalogDb(records, { run = {}, pointer = {} } = {}) {
  const currentPointer = {
    runId: 'ready-run',
    counts: { sources: 1, brands: 1, foods: records.length },
    catalogSha256: 'a'.repeat(64),
    payloadSha256: 'b'.repeat(64),
    ...pointer,
  };
  const runManifest = {
    status: 'ready',
    runId: 'ready-run',
    counts: currentPointer.counts,
    catalogSha256: currentPointer.catalogSha256,
    payloadSha256: currentPointer.payloadSha256,
    ...run,
  };
  const calls = [];

  return {
    calls,
    doc(path) {
      return {
        async get() {
          if (path === 'franchiseCatalogState/current') return snapshot(currentPointer);
          if (path === 'franchiseCatalogRuns/ready-run') return snapshot(runManifest);
          throw new Error(`unexpected document read: ${path}`);
        },
      };
    },
    collection(path) {
      assert.equal(path, 'franchiseCatalogRuns/ready-run/foods');
      return {
        where(field, operator, token) {
          calls.push({ field, operator, token });
          return {
            limit(limit) {
              calls.at(-1).limit = limit;
              return {
                async get() {
                  return { docs: records.map((record) => ({ data: () => record })) };
                },
              };
            },
          };
        },
      };
    },
  };
}

test('normalizes Subway aliases without erasing Korean identity', () => {
  assert.equal(normalizeCatalogText('  서브웨이  Italian B.M.T.™ '), '서브웨이 italian bmt');
});

test('queries one strongest catalog token then applies every query token in memory', async () => {
  const matching = subwayBmtFixture;
  const wrongMenu = {
    ...subwayBmtFixture,
    id: 'subway-turkey',
    name: '터키',
    aliases: ['turkey', '터키'],
    normalizedName: '터키',
    searchTokens: ['subway', '써브웨이', '서브웨이', '터키', 'turkey'],
    sourceId: 'subway-menu-turkey',
  };
  const db = readyCatalogDb([matching, wrongMenu]);

  const result = await queryCatalogFoods(db, '서브웨이 이탈리안BMT');

  assert.deepEqual(db.calls, [{ field: 'searchTokens', operator: 'array-contains', token: '이탈리안', limit: 101 }]);
  assert.deepEqual(result.items.map((item) => item.foodKey), ['catalog_official_subway_1528']);
  assert.equal(result.hasMore, false);
});

test('finds the official BMT through both Subway spellings and an exact menu-only query', async () => {
  for (const query of ['써브웨이', '서브웨이', '이탈리안 비엠티']) {
    const db = readyCatalogDb([subwayBmtFixture]);
    const result = await queryCatalogFoods(db, query);

    assert.deepEqual(result.items.map((item) => item.foodKey), ['catalog_official_subway_1528']);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].field, 'searchTokens');
    assert.equal(db.calls[0].operator, 'array-contains');
    assert.equal(db.calls[0].limit, 101);
  }
});

test('does not read Firestore for an empty catalog query', async () => {
  const db = readyCatalogDb([subwayBmtFixture]);

  assert.deepEqual(await queryCatalogFoods(db, '   '), { items: [], hasMore: false });
  assert.deepEqual(db.calls, []);
});

test('caps a broad brand-only catalog result set at 100 and reports hasMore', async () => {
  const records = Array.from({ length: 101 }, (_, index) => ({
    ...subwayBmtFixture,
    id: `official_subway_${String(index).padStart(3, '0')}`,
    sourceId: `subway-menu-${index}`,
  }));
  const db = readyCatalogDb(records);

  const result = await queryCatalogFoods(db, '서브웨이');

  assert.equal(result.items.length, 100);
  assert.equal(result.hasMore, true);
  assert.deepEqual(db.calls, [{ field: 'searchTokens', operator: 'array-contains', token: '서브웨이', limit: 101 }]);
});

test('rejects a pointer mismatch or any malformed returned catalog record as a source failure', async () => {
  const pointerMismatch = readyCatalogDb([subwayBmtFixture], {
    run: { payloadSha256: 'c'.repeat(64) },
  });
  const malformedRecord = readyCatalogDb([
    subwayBmtFixture,
    { ...subwayBmtFixture, id: 'invalid-bmt', nutrients: { ...subwayBmtFixture.nutrients, kcal: -1 } },
  ]);

  await assert.rejects(queryCatalogFoods(pointerMismatch, '써브웨이'), /does not match ready run manifest/);
  await assert.rejects(queryCatalogFoods(malformedRecord, '써브웨이'), /kcal must be null or a finite non-negative number/);
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

test('ranks the canonical BMT ahead of a competing catalog item for both Subway spellings', () => {
  const searchFood = catalog.catalogRecordToSearchFood(subwayBmtFixture);
  const competingFood = catalog.catalogRecordToSearchFood({
    ...subwayBmtFixture,
    id: 'official_aaa_other_sandwich',
    brandId: 'other-brand',
    brandName: '다른브랜드',
    name: '다른 샌드위치',
    aliases: ['other sandwich', '다른 샌드위치'],
    normalizedName: '다른 샌드위치',
    searchTokens: ['other', '다른', '다른브랜드', '샌드위치'],
    sourceId: 'other-sandwich',
  });

  for (const query of ['써브웨이', '서브웨이']) {
    const result = catalog.mergeCatalogAndMfdsResults([competingFood, searchFood], [], query);
    assert.equal(result[0], searchFood);
    assert.equal(result.length, 2);
  }
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

test('keeps non-mass official nutrients out of gram compatibility fields', () => {
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

  assert.deepEqual(searchFood.per100g, {
    kcal: null,
    carbG: null,
    proteinG: null,
    fatG: null,
  });
  assert.equal(searchFood.basis, '개');
  assert.deepEqual(searchFood.servingNutrients, record.nutrients);
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
