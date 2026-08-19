import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveBarcodeSources } from '../public/barcodeLookupFlow.js';

test('uses a shared hit without calling Open Food Facts', async () => {
  let offCalls = 0;
  const food = { name: '공용 제품' };
  assert.deepEqual(await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => food,
    lookupOff: async () => { offCalls += 1; return { name: 'OFF 제품' }; },
  }), { food, source: 'shared', sharedUnavailable: false, offUnavailable: false });
  assert.equal(offCalls, 0);
});

test('falls back to OFF for a shared miss or shared outage', async () => {
  const off = { name: 'OFF 제품' };
  assert.deepEqual(await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => null,
    lookupOff: async () => off,
  }), { food: off, source: 'off', sharedUnavailable: false, offUnavailable: false });
  assert.deepEqual(await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => { throw new Error('503'); },
    lookupOff: async () => off,
  }), { food: off, source: 'off', sharedUnavailable: true, offUnavailable: false });
});

test('distinguishes honest misses from provider failures', async () => {
  assert.deepEqual(await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => null,
    lookupOff: async () => null,
  }), { food: null, source: null, sharedUnavailable: false, offUnavailable: false });
  assert.deepEqual(await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => { throw new Error('503'); },
    lookupOff: async () => { throw new Error('network'); },
  }), { food: null, source: null, sharedUnavailable: true, offUnavailable: true });
});
