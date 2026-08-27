import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createBarcodeFood, runBarcodeLookup } from '../functions/index.js';

function request(code = '036000291452', authorization = 'Bearer test-token') {
  return {
    query: { code },
    get: (name) => (name === 'Authorization' ? authorization : undefined),
  };
}

function identityRequest(code = '036000291452') {
  const req = request(code);
  req.query.includeIdentity = '1';
  return req;
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

test('returns shared-catalog hit and exact miss without changing the record', async () => {
  const item = { barcode: '0036000291452', name: '검증 제품' };
  assert.deepEqual(await runBarcodeLookup('036000291452', {
    queryBarcodeCatalog: async () => item,
  }), { item, source: 'shared-catalog' });
  assert.deepEqual(await runBarcodeLookup('036000291452', {
    queryBarcodeCatalog: async () => null,
  }), { item: null });
});

test('authenticates before parsing or querying and classifies 400 and 503', async () => {
  let queried = false;
  const unauthorized = createBarcodeFood({
    authenticate: async () => { throw { status: 401, message: '로그인이 필요하다' }; },
    queryBarcodeCatalog: async () => { queried = true; },
  });
  const unauthorizedResponse = response();
  await unauthorized(request('', ''), unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.equal(queried, false);

  const invalid = createBarcodeFood({
    authenticate: async () => {},
    queryBarcodeCatalog: async () => { queried = true; },
  });
  const invalidResponse = response();
  await invalid(request('invalid'), invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(queried, false);

  const unavailable = createBarcodeFood({
    authenticate: async () => {},
    queryBarcodeCatalog: async () => { throw new Error('database unavailable'); },
  });
  const unavailableResponse = response();
  await unavailable(request(), unavailableResponse);
  assert.equal(unavailableResponse.statusCode, 503);
  assert.deepEqual(unavailableResponse.body, { error: '바코드 카탈로그를 확인하지 못했다' });
});

test('queries UPC identity only when explicitly requested after a shared miss', async () => {
  let identityCalls = 0;
  const handler = createBarcodeFood({
    authenticate: async () => {},
    queryBarcodeCatalog: async () => null,
    // **주입하지 않으면 실제 코리안넷을 친다.** 2026-08-27 에 이 테스트가 그래서
    // 319ms 를 쓰고 실패했다 — 외부 조회가 성공해서 UPCitemdb 까지 가지 않았다.
    lookupKoreannetIdentity: async () => null,
    lookupUpcIdentity: async (code) => {
      identityCalls += 1;
      return { barcode: `0${code}`, name: '제품명', provider: 'upcitemdb' };
    },
  });

  const basic = response();
  await handler(request(), basic);
  assert.deepEqual(basic.body, { item: null });
  assert.equal(identityCalls, 0);

  const enriched = response();
  await handler(identityRequest(), enriched);
  assert.equal(identityCalls, 1);
  assert.equal(enriched.body.item, null);
  assert.equal(enriched.body.identity.provider, 'upcitemdb');
  assert.deepEqual(enriched.body.providers, { shared: 'miss', koreannet: 'miss', upcitemdb: 'hit' });
});

test('hosting routes the exact barcode API without changing food search routing', async () => {
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.hosting.rewrites.filter(({ source }) => source.startsWith('/api/foods/')), [
    {
      source: '/api/foods/search',
      function: { functionId: 'searchFoods', region: 'asia-northeast3' },
    },
    {
      source: '/api/foods/barcode',
      function: { functionId: 'barcodeFood', region: 'asia-northeast3' },
    },
  ]);
});

// ── 코리안넷을 UPCitemdb 앞에 둔다 (2026-08-27) ──────────────────────────────
// 국내 바코드의 이름을 아는 곳이 코리안넷이다. 실측(실제 880 바코드 N=300):
// 이름 있음 93.7% · 에러 0 · p50 233ms. UPCitemdb 는 국내 제품을 거의 모른다.

test('prefers the koreannet identity over upcitemdb for a domestic barcode', async () => {
  const calls = [];
  const identity = {
    barcode: '8809396600014',
    name: '감동란',
    brand: '(주)마루카네코리아',
    provider: 'koreannet',
    fullTitle: '(주)마루카네코리아 감동란 감동란 50G x 2EA',
  };
  const result = await runBarcodeLookup('8809396600014', {
    queryBarcodeCatalog: async () => { calls.push('shared'); return null; },
    lookupKoreannetIdentity: async () => { calls.push('koreannet'); return identity; },
    lookupUpcIdentity: async () => { calls.push('upcitemdb'); return { provider: 'upcitemdb' }; },
  }, { includeIdentity: true });

  assert.deepEqual(calls, ['shared', 'koreannet']);
  assert.deepEqual(result, {
    item: null,
    identity,
    providers: { shared: 'miss', koreannet: 'hit' },
  });
});

test('falls through to upcitemdb when koreannet has no record', async () => {
  const calls = [];
  const result = await runBarcodeLookup('036000291452', {
    queryBarcodeCatalog: async () => { calls.push('shared'); return null; },
    lookupKoreannetIdentity: async () => { calls.push('koreannet'); return null; },
    lookupUpcIdentity: async () => { calls.push('upcitemdb'); return { provider: 'upcitemdb' }; },
  }, { includeIdentity: true });

  assert.deepEqual(calls, ['shared', 'koreannet', 'upcitemdb']);
  assert.deepEqual(result.providers, { shared: 'miss', koreannet: 'miss', upcitemdb: 'hit' });
});

test('keeps looking when koreannet itself throws instead of failing the request', async () => {
  // 조회 실패는 「제품 없음」이 아니다. 여기서 죽으면 되던 UPCitemdb 조회까지 못 한다.
  const calls = [];
  const result = await runBarcodeLookup('036000291452', {
    queryBarcodeCatalog: async () => { calls.push('shared'); return null; },
    lookupKoreannetIdentity: async () => { calls.push('koreannet'); throw new Error('gs1 timeout'); },
    lookupUpcIdentity: async () => { calls.push('upcitemdb'); return { provider: 'upcitemdb' }; },
  }, { includeIdentity: true });

  assert.deepEqual(calls, ['shared', 'koreannet', 'upcitemdb']);
  assert.deepEqual(result.providers, { shared: 'miss', koreannet: 'miss', upcitemdb: 'hit' });
});

test('does not touch koreannet when the caller did not ask for an identity', async () => {
  const calls = [];
  await runBarcodeLookup('8809396600014', {
    queryBarcodeCatalog: async () => { calls.push('shared'); return null; },
    lookupKoreannetIdentity: async () => { calls.push('koreannet'); return {}; },
    lookupUpcIdentity: async () => { calls.push('upcitemdb'); return null; },
  });
  assert.deepEqual(calls, ['shared']);
});

test('leaves a non-korean barcode to upcitemdb instead of asking koreannet', async () => {
  // 배포본 실측(2026-08-27): 036000291452 에 코리안넷이 「한얼」을 줬고 그게
  // UPCitemdb 를 가로챘다. 실제 조회 함수가 프리픽스를 보고 스스로 빠진다.
  const { lookupKoreannetIdentity } = await import('../functions/koreannet.js');
  let fetched = 0;
  const result = await lookupKoreannetIdentity('036000291452', {
    fetchImpl: async () => { fetched += 1; throw new Error('불려서는 안 된다'); },
  });
  assert.equal(result, null);
  assert.equal(fetched, 0);
});

test('still asks koreannet for a korean barcode', async () => {
  const { lookupKoreannetIdentity } = await import('../functions/koreannet.js');
  let asked = null;
  await lookupKoreannetIdentity('8809396600014', {
    fetchImpl: async (url) => { asked = url; return { ok: false, status: 500 }; },
  });
  assert.match(asked, /gs1\.koreannet\.or\.kr\/pr\/8809396600014$/);
});
