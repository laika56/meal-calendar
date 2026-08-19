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

test('uses UPC identity only after shared and OFF miss without treating it as food', async () => {
  const calls = [];
  const identity = { barcode: '8801007901244', name: '제품명', provider: 'upcitemdb' };
  assert.deepEqual(await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => { calls.push('shared'); return null; },
    lookupOff: async () => { calls.push('off'); return null; },
    lookupIdentity: async () => { calls.push('identity'); return identity; },
  }), {
    food: null, identity, source: 'upcitemdb',
    sharedUnavailable: false, offUnavailable: false, upcUnavailable: false,
  });
  assert.deepEqual(calls, ['shared', 'off', 'identity']);
});

test('does not call UPC identity after a shared or OFF nutrition hit', async () => {
  let identityCalls = 0;
  await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => ({ name: 'shared' }),
    lookupOff: async () => null,
    lookupIdentity: async () => { identityCalls += 1; return null; },
  });
  await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => null,
    lookupOff: async () => ({ name: 'off' }),
    lookupIdentity: async () => { identityCalls += 1; return null; },
  });
  assert.equal(identityCalls, 0);
});
