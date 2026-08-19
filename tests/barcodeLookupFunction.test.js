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
