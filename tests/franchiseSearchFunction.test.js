import assert from 'node:assert/strict';
import test from 'node:test';

import { runSearchFoods } from '../functions/index.js';
import { catalogRecordToSearchFood } from '../functions/shared/franchiseCatalog.js';

const catalogRecord = {
  id: 'official_subway_1528',
  brandId: 'subway',
  brandName: '써브웨이',
  name: '이탈리안 비엠티',
  aliases: ['italian bmt', '이탈리안 비엠티'],
  normalizedName: '이탈리안 비엠티',
  searchTokens: ['bmt', 'italian', 'subway', '써브웨이', '서브웨이', '이탈리안', '비엠티'],
  category: '샌드위치',
  basis: { amount: 228, unit: 'g', label: '1인분' },
  nutrients: { kcal: 388, carbG: null, proteinG: 21, fatG: null, sugarG: 8.6, sodiumMg: 1064 },
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

const officialBmt = catalogRecordToSearchFood(catalogRecord);
const publicBmt = {
  foodCode: 'public-bmt',
  name: '이탈리안 비엠티',
  category: '샌드위치',
  maker: '써브웨이',
  isFranchise: true,
  per100g: { kcal: 170, carbG: null, proteinG: 9, fatG: null },
  basis: 'g',
  serving: { amount: 228, unit: 'g', source: 'serving-field' },
  source: { type: 'public_data', label: '공공데이터', url: 'https://example.test/mfds', verifiedAt: '2026-08-18T00:00:00.000Z' },
};

function mfdsResult(items = [publicBmt]) {
  return {
    items,
    attempts: [{ FOOD_NM_KR: '이탈리안 비엠티', count: items.length }],
    skipped: 0,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('starts catalog and MFDS together, then keeps the reviewed official BMT over a duplicate public result', async () => {
  const catalog = deferred();
  const mfds = deferred();
  let catalogStarted = false;
  let mfdsStarted = false;

  const responsePromise = runSearchFoods('서브웨이 이탈리안BMT', {
    queryCatalogFoods: async () => {
      catalogStarted = true;
      return catalog.promise;
    },
    searchMfdsFoods: async () => {
      mfdsStarted = true;
      return mfds.promise;
    },
    cacheFoodItems: async () => {},
  });
  await Promise.resolve();
  assert.equal(catalogStarted, true);
  assert.equal(mfdsStarted, true);
  catalog.resolve({ items: [officialBmt], hasMore: false });
  mfds.resolve(mfdsResult());

  const response = await responsePromise;

  assert.deepEqual(response.items, [officialBmt]);
  assert.deepEqual(response.attempts, mfdsResult().attempts);
  assert.equal(response.skipped, 0);
  assert.equal(response.hasMore, false);
  assert.equal(Object.hasOwn(response, 'catalogUnavailable'), false);
  assert.equal(Object.hasOwn(response, 'mfdsUnavailable'), false);
});

test('keeps catalog results and marks MFDS unavailable when every MFDS request fails', async () => {
  const mfdsError = Object.assign(new Error('mfds failed'), {
    attempts: [{ FOOD_NM_KR: '이탈리안 비엠티', count: null, failed: true }],
    skipped: 0,
  });

  const response = await runSearchFoods('이탈리안 비엠티', {
    queryCatalogFoods: async () => ({ items: [officialBmt], hasMore: true }),
    searchMfdsFoods: async () => { throw mfdsError; },
    cacheFoodItems: async () => { throw new Error('cache must not run'); },
  });

  assert.deepEqual(response.items, [officialBmt]);
  assert.equal(response.hasMore, true);
  assert.equal(response.mfdsUnavailable, true);
  assert.deepEqual(response.attempts, mfdsError.attempts);
  assert.equal(response.skipped, 0);
});

test('keeps MFDS results and marks catalog unavailable when catalog validation fails', async () => {
  const response = await runSearchFoods('김밥', {
    queryCatalogFoods: async () => { throw new Error('catalog manifest mismatch'); },
    searchMfdsFoods: async () => mfdsResult(),
    cacheFoodItems: async () => {},
  });

  assert.deepEqual(response.items, [publicBmt]);
  assert.equal(response.hasMore, false);
  assert.equal(response.catalogUnavailable, true);
  assert.equal(Object.hasOwn(response, 'mfdsUnavailable'), false);
});

test('returns a 502 error only when both catalog and MFDS sources fail', async () => {
  await assert.rejects(
    runSearchFoods('김밥', {
      queryCatalogFoods: async () => { throw new Error('catalog unavailable'); },
      searchMfdsFoods: async () => { throw new Error('mfds unavailable'); },
      cacheFoodItems: async () => {},
    }),
    (error) => error.status === 502 && error.message === '식약처 API와 프랜차이즈 카탈로그 호출에 실패했다',
  );
});

test('returns validated source results when the MFDS cache write fails', async () => {
  const response = await runSearchFoods('김밥', {
    queryCatalogFoods: async () => ({ items: [officialBmt], hasMore: false }),
    searchMfdsFoods: async () => mfdsResult(),
    cacheFoodItems: async () => { throw new Error('cache unavailable'); },
  });

  assert.deepEqual(response.items, [officialBmt]);
  assert.equal(response.hasMore, false);
});
