import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toMyBarcodeRecord, fromMyBarcodeRecord, myBarcodeDocId,
} from '../src/lib/myBarcodeCache.js';

const SAVED_AT = '2026-08-26T06:00:00.000Z';

const OFF_FOOD = {
  foodKey: 'off_8801115111054',
  name: '나 100% 1급A우유 2.3L',
  maker: '남양유업',
  source: 'off',
  barcode: '8801115111054',
  per100g: { kcal: 70, carbG: 4.8, proteinG: 3.2, fatG: 3.6 },
  basis: 'g',
  serving: { amount: 200, unit: 'mL' },
};

// ── undefined 금지 ────────────────────────────────────────────────────
// Firestore 는 undefined 필드 하나로 setDoc 전체를 거부한다. 2026-08-14 에
// 실제로 라벨 표에 없는 키가 undefined 로 들어가 저장이 통째로 실패했다.

test('저장 레코드에 undefined 가 하나도 없다', () => {
  const record = toMyBarcodeRecord(OFF_FOOD, SAVED_AT);
  const walk = (value, path) => {
    assert.notEqual(value, undefined, `${path} 가 undefined 다 — Firestore 가 거부한다`);
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    }
  };
  walk(record, 'record');
});

test('값이 없는 영양소는 undefined 가 아니라 null 이다', () => {
  const record = toMyBarcodeRecord({
    ...OFF_FOOD,
    per100g: { kcal: 510 }, // 탄단지 없음
    maker: undefined,
    serving: undefined,
  }, SAVED_AT);
  assert.deepEqual(record.per100g, { kcal: 510, carbG: null, proteinG: null, fatG: null });
  assert.equal(record.maker, null);
  assert.equal(record.serving, null);
});

// ── 저장 거부 조건 ────────────────────────────────────────────────────
// 모르는 값을 채우지 않는다 (절대규칙 2·7).

test('열량이 없으면 저장하지 않는다', () => {
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, per100g: { kcal: null } }, SAVED_AT), null);
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, per100g: {} }, SAVED_AT), null);
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, per100g: { kcal: NaN } }, SAVED_AT), null);
});

test('바코드나 이름이 없으면 저장하지 않는다', () => {
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, barcode: '' }, SAVED_AT), null);
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, name: '   ' }, SAVED_AT), null);
});

test('food 가 아닌 것은 조용히 null 이다', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.equal(toMyBarcodeRecord(bad, SAVED_AT), null);
  }
});

test('savedAt 을 지어내지 않는다 — 안 주면 예외', () => {
  assert.throws(() => toMyBarcodeRecord(OFF_FOOD, ''), TypeError);
  assert.throws(() => toMyBarcodeRecord(OFF_FOOD, undefined), TypeError);
});

// ── 왕복 ──────────────────────────────────────────────────────────────

test('저장했다 읽으면 영양값이 그대로다', () => {
  const restored = fromMyBarcodeRecord(toMyBarcodeRecord(OFF_FOOD, SAVED_AT));
  assert.deepEqual(restored.per100g, OFF_FOOD.per100g);
  assert.equal(restored.name, OFF_FOOD.name);
  assert.equal(restored.barcode, OFF_FOOD.barcode);
  assert.deepEqual(restored.serving, OFF_FOOD.serving);
});

test('되살린 food 의 출처는 mine 이다', () => {
  // 화면이 「내가 전에 확인한 값」과 공용 카탈로그 값을 구분할 수 있어야 한다.
  const restored = fromMyBarcodeRecord(toMyBarcodeRecord(OFF_FOOD, SAVED_AT));
  assert.equal(restored.source, 'mine');
  assert.equal(restored.foodKey, 'mine_8801115111054');
});

test('원래 출처를 기록에 남긴다', () => {
  assert.equal(toMyBarcodeRecord(OFF_FOOD, SAVED_AT).origin, 'off');
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, source: null }, SAVED_AT).origin, 'manual');
});

test('깨진 문서 때문에 스캔이 죽지 않는다', () => {
  for (const bad of [null, undefined, 'x', [], {}, { barcode: '8801115111054' }]) {
    assert.equal(fromMyBarcodeRecord(bad), null);
  }
});

test('부분적으로 깨진 1회분은 통째로 버린다', () => {
  // 양은 있는데 단위가 없으면 그 숫자가 뭔지 모른다. 반쯤 맞는 값이 제일 위험하다.
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, serving: { amount: 200 } }, SAVED_AT).serving, null);
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, serving: { unit: 'g' } }, SAVED_AT).serving, null);
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, serving: { amount: 0, unit: 'g' } }, SAVED_AT).serving, null);
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, serving: { amount: -5, unit: 'g' } }, SAVED_AT).serving, null);
});

test('mL 기준을 잃지 않는다', () => {
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, basis: 'mL' }, SAVED_AT).basis, 'mL');
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, basis: 'ml' }, SAVED_AT).basis, 'mL');
  assert.equal(toMyBarcodeRecord({ ...OFF_FOOD, basis: 'g' }, SAVED_AT).basis, 'g');
});

// ── 문서 id ───────────────────────────────────────────────────────────

test('문서 id 는 숫자 바코드만 허용한다', () => {
  assert.equal(myBarcodeDocId('8801115111054'), '8801115111054');
  assert.equal(myBarcodeDocId('  8801115111054  '), '8801115111054');
  assert.equal(myBarcodeDocId('12345678'), '12345678');
});

test('경로를 깨뜨릴 수 있는 값은 문서 id 가 되지 않는다', () => {
  // Firestore 문서 id 에 `/` 가 들어가면 경로가 통째로 달라진다.
  for (const bad of ['../users/other', 'a/b', '', '   ', null, undefined, 42, '1234567']) {
    assert.equal(myBarcodeDocId(bad), null);
  }
});
