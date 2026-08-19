import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupUpcItemIdentity } from '../functions/upcItemDb.js';

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('returns one exact canonical identity without nutrition fields', async () => {
  const identity = await lookupUpcItemIdentity('8801234567893', {
    fetchImpl: async () => response({ total: 1, items: [{
      ean: '8801234567893', title: '제품명', brand: '브랜드', category: '분류',
      images: ['https://example.com/a.jpg'], description: '100 kcal',
    }] }),
  });
  assert.deepEqual(identity, {
    barcode: '8801234567893', name: '제품명', brand: '브랜드', category: '분류',
    imageUrl: 'https://example.com/a.jpg', provider: 'upcitemdb',
  });
  assert.equal('kcal' in identity, false);
});

test('treats no exact item or multiple exact items as an honest miss', async () => {
  assert.equal(await lookupUpcItemIdentity('8801234567893', {
    fetchImpl: async () => response({ total: 0, items: [] }),
  }), null);
  assert.equal(await lookupUpcItemIdentity('8801234567893', {
    fetchImpl: async () => response({ total: 2, items: [
      { ean: '8801234567893', title: 'A' }, { ean: '8801234567893', title: 'B' },
    ] }),
  }), null);
});

test('fails closed for malformed responses and provider errors', async () => {
  await assert.rejects(() => lookupUpcItemIdentity('8801234567893', {
    fetchImpl: async () => response({ total: 1, items: [{ ean: '8801234567893', title: '' }] }),
  }), /malformed/);
  await assert.rejects(() => lookupUpcItemIdentity('8801234567893', {
    fetchImpl: async () => response({}, { ok: false, status: 429 }),
  }), /HTTP 429/);
});

test('passes an abort signal to the provider request', async () => {
  let signal;
  await assert.rejects(() => lookupUpcItemIdentity('8801234567893', {
    timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
  }));
  assert.equal(signal.aborted, true);
});
