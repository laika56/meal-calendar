import test from 'node:test';
import assert from 'node:assert/strict';

import { barcodeLookupFailureMessage, resolveBarcodeSources } from '../public/barcodeLookupFlow.js';

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

test('keeps an OFF identity and skips the later identity provider when nutrition is absent', async () => {
  let identityCalls = 0;
  const identity = {
    barcode: '8801492391995', name: '마늘 후랑크', brand: '하림', provider: 'off',
  };
  assert.deepEqual(await resolveBarcodeSources('8801492391995', {
    lookupShared: async () => null,
    lookupOff: async () => ({ food: null, identity }),
    lookupIdentity: async () => { identityCalls += 1; return null; },
  }), {
    food: null, identity, source: 'off-identity',
    sharedUnavailable: false, offUnavailable: false, upcUnavailable: false,
  });
  assert.equal(identityCalls, 0);
});

test('tells a valid recognized code apart from a camera recognition failure', () => {
  assert.equal(
    barcodeLookupFailureMessage('8801056249052', {
      sharedUnavailable: false, offUnavailable: false, upcUnavailable: false,
    }),
    '바코드 8801056249052는 읽었지만 제품 정보를 찾지 못했습니다. 제품명이나 영양성분표로 입력해 주세요.',
  );
  assert.equal(
    barcodeLookupFailureMessage('8801056249052', {
      sharedUnavailable: true, offUnavailable: true, upcUnavailable: true,
    }),
    '바코드 8801056249052는 읽었지만 제품 조회 서비스에 연결하지 못했습니다. 직접 입력해 주세요.',
  );
});

// ── 내가 이미 확인한 제품 (users/{uid}/barcodes) ──────────────────────
//
// 영양성분표를 직접 찍어 입력한 제품이 다음 스캔에서 또 miss 나는 것이 실측으로
// 확인됐다 (2026-08-26). 국내 바코드 커버리지가 낮아 이 경로가 자주 걸린다.
// 내가 확인한 값이 가장 신뢰도 높으므로 **공용 카탈로그보다 먼저** 본다.
//
// `lookupMine` 은 선택 의존성이다 — 안 넘기면 기존 3단계가 그대로 돈다.
// 공용 캐시(`foods/`)에는 쓰지 않는다. 개인 스캔 이력을 공용에 올리지 않는다는
// 규칙(docs/NEXT.md)을 지키려면 저장 위치가 users/{uid} 밑이어야 한다.

test('내가 확인한 제품이 있으면 공용·OFF 를 아예 부르지 않는다', async () => {
  const calls = [];
  const mine = { name: '내가 찍어 넣은 제품' };
  const result = await resolveBarcodeSources('8801007901244', {
    lookupMine: async () => { calls.push('mine'); return mine; },
    lookupShared: async () => { calls.push('shared'); return { name: '공용' }; },
    lookupOff: async () => { calls.push('off'); return { name: 'OFF' }; },
  });
  assert.equal(result.food, mine);
  assert.equal(result.source, 'mine');
  assert.deepEqual(calls, ['mine']);
});

test('내 기록에 없으면 기존 순서대로 내려간다', async () => {
  const calls = [];
  const shared = { name: '공용 제품' };
  const result = await resolveBarcodeSources('8801007901244', {
    lookupMine: async () => { calls.push('mine'); return null; },
    lookupShared: async () => { calls.push('shared'); return shared; },
    lookupOff: async () => { calls.push('off'); return null; },
  });
  assert.equal(result.food, shared);
  assert.equal(result.source, 'shared');
  assert.deepEqual(calls, ['mine', 'shared']);
});

test('내 기록 조회가 실패해도 나머지 조회를 막지 않는다', async () => {
  // 오프라인이거나 규칙이 막으면 던진다. 그것 때문에 공용·OFF 까지 포기하면
  // 되던 것도 안 되게 만든다.
  const shared = { name: '공용 제품' };
  const result = await resolveBarcodeSources('8801007901244', {
    lookupMine: async () => { throw new Error('permission-denied'); },
    lookupShared: async () => shared,
    lookupOff: async () => null,
  });
  assert.equal(result.food, shared);
  assert.equal(result.source, 'shared');
});

test('lookupMine 을 안 넘기면 기존 반환 형태가 그대로다', async () => {
  // 회귀 방지 — 이 단계를 추가하면서 기존 호출부의 반환 계약이 바뀌면 안 된다.
  const food = { name: '공용 제품' };
  assert.deepEqual(await resolveBarcodeSources('8801007901244', {
    lookupShared: async () => food,
    lookupOff: async () => null,
  }), { food, source: 'shared', sharedUnavailable: false, offUnavailable: false });
});
