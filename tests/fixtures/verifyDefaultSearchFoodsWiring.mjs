import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock } from 'node:test';

const functionsRequire = createRequire(new URL('../../functions/index.js', import.meta.url));
const firebaseAppModule = functionsRequire.resolve('firebase-admin/app');
const firebaseAuthModule = functionsRequire.resolve('firebase-admin/auth');
const firebaseFirestoreModule = functionsRequire.resolve('firebase-admin/firestore');

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

const pointer = {
  runId: 'ready-run',
  counts: { sources: 1, brands: 1, foods: 1 },
  catalogSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64),
};
const run = { status: 'ready', ...pointer };
let releaseAuth;
const authGate = new Promise((resolve) => { releaseAuth = resolve; });
let catalogReads = 0;
let mfdsRequests = 0;
let cacheWrites = 0;

mock.module(firebaseAppModule, {
  exports: { initializeApp: () => ({ name: 'test-app' }) },
});
mock.module(firebaseAuthModule, {
  exports: {
    getAuth: () => ({
      verifyIdToken: async () => {
        await authGate;
        return { uid: 'user-1' };
      },
    }),
  },
});
mock.module(firebaseFirestoreModule, {
  exports: {
    FieldValue: { serverTimestamp: () => 'server-timestamp' },
    getFirestore: () => ({
      doc(path) {
        return {
          async get() {
            catalogReads += 1;
            if (path === 'franchiseCatalogState/current') return { exists: true, data: () => pointer };
            if (path === 'franchiseCatalogRuns/ready-run') return { exists: true, data: () => run };
            throw new Error(`unexpected document: ${path}`);
          },
        };
      },
      collection(path) {
        if (path === 'franchiseCatalogRuns/ready-run/foods') {
          return {
            where(field, operator, token) {
              assert.equal(field, 'searchTokens');
              assert.equal(operator, 'array-contains');
              assert.equal(token, '이탈리안');
              return {
                limit(limit) {
                  assert.equal(limit, 101);
                  return { async get() { return { docs: [{ data: () => catalogRecord }] }; } };
                },
              };
            },
          };
        }
        if (path === 'foods') return { doc: (id) => ({ id }) };
        throw new Error(`unexpected collection: ${path}`);
      },
      batch() {
        return {
          set(ref, value, options) {
            cacheWrites += 1;
            assert.equal(ref.id, 'mfds_public-bmt');
            assert.equal(value.source, 'mfds');
            assert.deepEqual(options, { merge: true });
          },
          async commit() {},
        };
      },
    }),
  },
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  mfdsRequests += 1;
  return {
    async json() {
      return {
        header: { resultCode: '00' },
        body: {
          totalCount: 1,
          items: [{
            FOOD_CD: 'public-bmt',
            FOOD_NM_KR: '이탈리안 비엠티',
            FOOD_CAT1_NM: '샌드위치',
            MAKER_NM: '서브웨이',
            FOOD_OR_CD: '2',
            DB_GRP_CM: 'D',
            SERVING_SIZE: '100g',
            AMT_NUM1: '170',
            AMT_NUM3: '9',
            AMT_NUM4: '',
            AMT_NUM6: '',
            Z10500: '228g',
            NUTRI_AMOUNT_SERVING: null,
          }],
        },
      };
    },
  };
};
process.env.MFDS_API_KEY = 'test-key';

function request() {
  return {
    query: { q: '서브웨이 이탈리안BMT' },
    get: (name) => (name === 'Authorization' ? 'Bearer valid-token' : undefined),
  };
}

function response() {
  const finishListeners = [];
  return {
    statusCode: null,
    body: null,
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) {
      this.body = body;
      for (const listener of finishListeners) listener();
      return this;
    },
    on(event, listener) {
      if (event === 'finish') finishListeners.push(listener);
      return this;
    },
  };
}

try {
  const { searchFoods } = await import('../../functions/index.js');
  const res = response();
  const completed = searchFoods(request(), res);

  await Promise.resolve();
  assert.equal(catalogReads, 0);
  assert.equal(mfdsRequests, 0);
  assert.equal(cacheWrites, 0);
  releaseAuth();
  await completed;

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map((item) => item.foodKey), ['catalog_official_subway_1528']);
  assert.equal(res.body.hasMore, false);
  assert.deepEqual(res.body.attempts, [{ FOOD_NM_KR: '서브웨이 이탈리안BMT', count: 1 }]);
  assert.equal(res.body.skipped, 0);
  assert.equal(Object.hasOwn(res.body, 'catalogUnavailable'), false);
  assert.equal(Object.hasOwn(res.body, 'mfdsUnavailable'), false);
  assert.equal(catalogReads, 2);
  assert.equal(mfdsRequests, 1);
  assert.equal(cacheWrites, 1);
  console.log('default searchFoods wiring: PASS');
} finally {
  globalThis.fetch = originalFetch;
}
