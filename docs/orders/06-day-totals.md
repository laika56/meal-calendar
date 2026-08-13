# 발주 06 — 일간 합계 집계 (Codex)

담당: **Codex** · 대상: `src/lib/dayTotals.js` (신규) · 선행: 없음

공통 계약은 `../../AGENTS.md`. **여기 안 적힌 동작을 지어내지 않는다.** 빠진 게 있으면 채우지 말고 알린다.

## 배경

Phase 3(Firestore + 수동 입력)의 순수 로직 부분. Firestore 연동·보안 규칙·UI는 Claude가 따로 만든다.
이 파일은 **메모리 안의 자료구조를 받아 합계를 내는 계산만** 한다. Firebase·DOM·네트워크 금지.

`docs/ARCHITECTURE.md` 「데이터 모델」의 `users/{uid}/days/{YYYY-MM-DD}` 구조를 그대로 쓴다:

```js
{
  slots: {
    breakfast: [ entry ], lunch: [ entry ], dinner: [ entry ], snack: [ entry ]
  },
  totals: { kcal, carbG, proteinG, fatG }   // ← 이 발주가 만드는 값
}
```

`entry` 형태 (같은 문서 참조). 이 발주가 쓰는 필드만 적는다:

```js
{
  kcal: number, carbG: number, proteinG: number, fatG: number,   // amountG 기준으로 이미 환산된 값
  // name, amountG, foodKey, addedBy, at 등 나머지 필드는 이 발주가 건드리지 않는다
}
```

> **중요:** `entry`의 영양값은 **이미 환산된 값**이다 (`units.js`의 `scaleNutrients`가 담당).
> 이 발주에서 100g 기준 환산을 다시 하지 않는다. **더하기만 한다.**

## 만들 것

`src/lib/dayTotals.js` — 순수 함수만. `import`는 `node:` 내장만 허용.

### A. `sumEntries(entries)`

`entry` 배열의 영양값을 합산한다.

**입력:** `entry` 객체의 배열. 빈 배열 허용.

**출력:**

```js
{ kcal: number, carbG: number, proteinG: number, fatG: number }
```

**동작:**

1. 빈 배열이면 `{ kcal: 0, carbG: 0, proteinG: 0, fatG: 0 }` 반환 (예외 아님 — 안 먹은 슬롯은 정상이다)
2. 각 필드를 독립적으로 더한다
3. **합계는 소수점 1자리로 반올림한다** (`Math.round(x * 10) / 10`).
   `units.js`의 `roundToOneDecimal`과 같은 규칙이지만 **그 함수를 import하지 않는다** —
   `units.js`는 export하지 않는 내부 함수다. 이 파일에 같은 규칙을 따로 구현한다.
   반올림은 **합산이 끝난 뒤 한 번만** 한다 (항목마다 반올림하면 오차가 누적된다)

**입력 검증:**

- `entries`가 배열이 아니면 `TypeError`:
  `` `sumEntries: entries must be an array, got ${JSON.stringify(entries)}` ``
- 배열 원소가 객체가 아니면(`null` 포함) `TypeError`:
  `` `sumEntries: entries[${i}] must be an object, got ${JSON.stringify(entry)}` ``
- 원소의 `kcal`/`carbG`/`proteinG`/`fatG` 중 하나라도 `number`가 아니거나 `NaN`이면 `TypeError`:
  `` `sumEntries: entries[${i}].${field} must be a number, got ${formatValue(value)}` ``
  - `formatValue`는 `NaN`일 때 리터럴 문자열 `NaN`, 그 외에는 `JSON.stringify` —
    **`metabolism.js`/`units.js`/`calendarGrid.js`에 이미 있는 것과 같은 관례다.** 그 구현을 이 파일에도 둔다
    (`JSON.stringify(NaN)`이 문자열 `"null"`을 반환하기 때문. 공유 모듈로 빼지 않는다 — 이 발주 범위 밖)
  - 필드 검사 순서: `kcal` → `carbG` → `proteinG` → `fatG`. 먼저 걸리는 것 하나만 던진다
- 값이 **음수**면 `RangeError`:
  `` `sumEntries: entries[${i}].${field} must not be negative, got ${value}` ``
  → 먹은 음식의 영양값은 음수일 수 없다. 음수가 들어왔으면 그 위(파서·입력폼)가 깨진 것이다.
  절대규칙 7 — 조용히 0으로 만들지 않는다
- **`null`은 허용하지 않는다.** `units.js`의 `scaleNutrients`는 `null`을 통과시키지만(값 없음),
  기록으로 저장되는 시점에는 숫자가 확정돼 있어야 한다. `null`이 오면 위 `TypeError`에 걸린다
  (`typeof null !== 'number'`). **이건 의도된 동작이다** — 값 없는 항목을 합계에 넣으면 안 된다

### B. `calcDayTotals(slots)`

하루 4개 슬롯 전체의 합계를 낸다.

**입력:**

```js
{ breakfast: [entry], lunch: [entry], dinner: [entry], snack: [entry] }
```

**출력:** `sumEntries`와 같은 형태 — `{ kcal, carbG, proteinG, fatG }`

**동작:**

1. 4개 슬롯의 `entry`를 **전부 한 배열로 모아 `sumEntries`에 한 번 넘긴다.**
   슬롯별로 `sumEntries`를 부른 뒤 그 결과를 다시 더하지 않는다 — 슬롯마다 반올림되어 오차가 누적된다
2. 슬롯 키가 없거나 값이 `undefined`면 빈 배열로 취급한다 (아직 안 먹은 슬롯)
3. 슬롯 키가 있는데 배열이 아니면 `TypeError`:
   `` `calcDayTotals: slots.${key} must be an array, got ${JSON.stringify(value)}` ``
4. `slots` 자체가 객체가 아니면(`null` 포함) `TypeError`:
   `` `calcDayTotals: slots must be an object, got ${JSON.stringify(slots)}` ``
5. **명세에 없는 슬롯 키는 무시한다.** `breakfast`/`lunch`/`dinner`/`snack` 4개만 본다
   (Firestore 문서에 나중에 다른 필드가 붙어도 이 함수가 안 깨져야 한다)

**슬롯 순서:** `breakfast` → `lunch` → `dinner` → `snack`. 검증 에러도 이 순서로 먼저 걸리는 것을 던진다.

### C. `totalsMatch(a, b)`

두 `totals` 객체가 같은지 비교한다. **`totals` 갱신 누락 탐지용이다** —
저장된 `totals`와 슬롯에서 다시 계산한 값이 어긋나면 어딘가에서 갱신을 빠뜨린 것이다.

**입력:** `{ kcal, carbG, proteinG, fatG }` 두 개

**출력:** `boolean`

**동작:**

- 4개 필드가 **전부 정확히 같으면** `true`, 하나라도 다르면 `false`
- 부동소수점 비교 오차를 감안해 **차이의 절댓값이 `0.05` 이하면 같다고 본다**
  (합계가 소수 1자리로 반올림되므로 정상 경로에서는 정확히 일치한다. 이 여유는 저장·직렬화 과정의
  미세 오차만 흡수한다 — `0.1` 차이는 진짜 불일치로 잡혀야 한다)
- 둘 중 하나라도 객체가 아니거나 필드가 `number`가 아니면 **`false`를 반환한다. 던지지 않는다**
  → 이 함수는 판정 도구다. 비교 자체가 불가능한 것도 "불일치"다

## 테스트

`tests/dayTotals.test.js`. `node:test` + `node:assert/strict`.

**금지 (절대규칙 2):** 실제 음식의 영양 수치를 픽스처에 쓰지 않는다. **전부 합성값**을 쓴다
(`{ kcal: 100, carbG: 10, proteinG: 5, fatG: 2 }` 처럼 계산하기 쉬운 임의의 숫자).
실제 음식 이름을 붙이지 않는다.

**필수 케이스:**

1. 빈 배열 → 전부 0 (던지지 않음)
2. 원소 1개 → 그 값 그대로
3. 원소 여러 개 → 각 필드가 독립적으로 합산되는지
4. **반올림이 마지막에 한 번만 되는지** — 소수 셋째 자리까지 있는 합성값 3개 이상을 더해서,
   "항목마다 반올림한 값의 합"과 "합산 후 한 번 반올림한 값"이 **다르게 나오는 입력**을 골라
   후자가 나오는지 확인한다 (이걸 확인 못 하면 이 테스트는 의미가 없다)
5. `calcDayTotals` — 4개 슬롯 전부 채운 경우, 일부 슬롯만 있는 경우, 전부 빈 경우
6. `calcDayTotals` — **슬롯별 반올림 누적이 없는지**: 4번과 같은 방식으로, 슬롯마다 반올림했을 때와
   전체를 한 번에 합쳤을 때가 달라지는 입력으로 확인
7. `calcDayTotals` — 명세에 없는 키(`supper` 등)가 있어도 무시하고 안 깨지는지
8. 검증 에러 — `entries`가 배열 아님 / 원소가 `null` / 각 필드가 `undefined`·`NaN`·문자열·음수.
   **메시지가 명세와 정확히 일치하는지** 확인한다
9. `totalsMatch` — 같은 값 `true`, `0.05` 경계 안쪽 `true`, `0.1` 차이 `false`,
   필드 하나만 다른 경우 `false`, 객체가 아닌 입력에서 **던지지 않고** `false`

## 완료 조건

- `npm test` 전체 통과 (기존 55개 + 신규)

## 완료 보고

`../../AGENTS.md`의 「완료 보고 형식」대로. `npm test` **실제 출력**을 붙인다.

## 판단이 필요하면

멈추고 묻는다. 특히 이 문서에 기대 동작이 안 적힌 입력을 발견했을 때.
