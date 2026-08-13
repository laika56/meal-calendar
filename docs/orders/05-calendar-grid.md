# 발주 05 — 월 캘린더 그리드 날짜 계산 (Codex)

담당: **Codex** · 대상: `src/lib/calendarGrid.js` (신규) · 선행: 없음

공통 계약은 `../../AGENTS.md`. **여기 안 적힌 동작을 지어내지 않는다.** 빠진 게 있으면 채우지 말고 알린다.

## 배경

Phase 1(PWA 셸 + 월 캘린더)의 순수 로직 부분. `docs/SPEC.md` 「1. 월간 캘린더」 참조.
DOM·렌더링은 Claude가 별도로 만든다. 이 파일은 **날짜 계산과 상태 판정만** 한다.

## 만들 것

`src/lib/calendarGrid.js` — 순수 함수만. `import`는 `node:` 내장만 허용. DOM·네트워크·Firebase 금지.

### A. `buildMonthGrid({ year, month, weekStartsOn = 0 })`

7열 × N행 캘린더 그리드용 날짜 배열을 만든다.

**입력:**
- `year`: 4자리 정수 (예: `2026`)
- `month`: 1~12 정수 (**1이 1월** — JS `Date`의 0-indexed 아님, 헷갈리지 않게 함수 내부에서 변환)
- `weekStartsOn`: `0`(일요일) ~ `6`(토요일). 기본값 `0`. 몇 요일부터 그리드를 시작할지

**출력:** 객체 배열. 각 원소:

```js
{
  date: "2026-08-01",       // YYYY-MM-DD, 로컬 날짜 문자열 (UTC 변환 없음)
  dayOfMonth: 1,             // 1~31
  weekday: 5,                // 0(일)~6(토). getDay() 값 그대로
  inCurrentMonth: true,       // 이 달 날짜인지 (앞뒤로 채워진 날짜는 false)
}
```

**동작:**

1. `year`월 `month`월의 1일이 무슨 요일인지 구한다.
2. 그리드 첫 칸을 `weekStartsOn`에 맞춘다 — 1일이 그리드 시작 요일이 아니면, **이전 달 날짜로 앞을 채운다**
   (`inCurrentMonth: false`).
3. 이번 달 날짜를 전부 채운다 (`inCurrentMonth: true`).
4. 마지막 주가 7의 배수로 안 끝나면 **다음 달 날짜로 뒤를 채운다** (`inCurrentMonth: false`).
5. **결과 배열 길이는 항상 7의 배수** (35 또는 42 — 그 달이 몇 주에 걸치는지에 따라). 6행이 필요 없으면
   35(5행)를 반환한다. 7행은 안 만든다 (달력이 최대 6행을 넘는 경우는 없다).
6. 날짜 문자열은 로컬 날짜 기준 `YYYY-MM-DD`. **연·월·일 전부 0패딩**: 월·일은 2자리
   (`padStart(2, '0')`), **연도는 4자리** (`padStart(4, '0')`) — `year: 5`면 `"0005-08-01"`이 된다.
   범위(1~9999) 전체에서 이 규칙을 예외 없이 적용한다. 실사용에서 4자리를 벗어나는 연도는 없지만
   검증 범위가 1~9999이므로 포맷 규칙도 그 전체에서 일관되게 정의한다.

**입력 검증:**

- `year`가 정수 아니거나 1~9999 범위 밖이면 `RangeError`:
  `` `buildMonthGrid: year must be an integer between 1 and 9999, got ${JSON.stringify(year)}` ``
- `month`가 1~12 범위 밖이거나 정수 아니면 `RangeError`:
  `` `buildMonthGrid: month must be an integer between 1 and 12, got ${JSON.stringify(month)}` ``
- `weekStartsOn`이 0~6 범위 밖이거나 정수 아니면 `RangeError`:
  `` `buildMonthGrid: weekStartsOn must be an integer between 0 and 6, got ${JSON.stringify(weekStartsOn)}` ``

> **주의 (2026-08-13 정정):** `JSON.stringify(NaN)`은 문자열 `"null"`을 반환한다 (실제 `null`이 아니라
> 오해를 주는 4글자 문자열). 값이 `NaN`으로 확인된 경우 `JSON.stringify` 대신 **리터럴 문자열
> `NaN`**을 메시지에 직접 쓴다 (`metabolism.js`/`units.js`에 이미 적용된 관례와 동일하게 맞춘다).
> 예: `year`가 `NaN`이면 메시지는 `...got NaN` (따옴표 없이), `...got null`이 되면 틀린 것이다.
> 이미 짠 세 개 검증(`year`/`month`/`weekStartsOn`) 전부와 **기존 테스트의 `NaN` 케이스**를 이 규칙에
> 맞게 고친다.

**경계 케이스 (테스트 필수):**

- 1일이 정확히 `weekStartsOn` 요일인 달 (앞쪽 채움 0칸)
- 1일이 `weekStartsOn` 바로 전날 요일인 달 (앞쪽 채움 6칸)
- 5행으로 끝나는 달과 6행으로 끝나는 달 둘 다
- 윤년 2월 29일 (`2028-02` 같은 실제 윤년으로 확인 — 계산으로 판정하되, `Date` 객체의 자동 날짜
  보정에 의존해도 되지만 결과가 맞는지 손으로 검증한 값과 대조)
- 평년 2월 (28일)
- 12월 → 다음 달(1월, 연도 넘어감) 채움이 맞는지
- 1월 → 이전 달(작년 12월, 연도 내려감) 채움이 맞는지
- `weekStartsOn: 1`(월요일 시작)로 바꿨을 때 같은 달의 그리드가 다르게 나오는지 (최소 1개 케이스)

### B. `dayStatus({ kcal, targetKcal, hasRecord })`

하루 칼로리가 목표 대비 어느 상태인지 판정한다. `docs/SPEC.md` 「1. 월간 캘린더」 상태표 그대로:

| 상태 | 조건 |
|---|---|
| `'none'` | `hasRecord`가 `false`일 때 (기록 자체가 없음) — 다른 조건보다 **우선** |
| `'under'` | `kcal / targetKcal < 0.9` |
| `'ok'` | `0.9 <= kcal / targetKcal <= 1.1` |
| `'over'` | `kcal / targetKcal > 1.1` |

**반환값:** 위 4개 문자열 중 하나.

**입력 검증:**

- `hasRecord`가 `false`면 `kcal`·`targetKcal` 값과 무관하게 `'none'`을 반환한다 (검증도 안 함 —
  기록이 없으면 애초에 의미 없는 숫자다. `hasRecord`가 `false`일 때 `kcal`이 `undefined`여도 통과해야 한다)
- `hasRecord`가 `true`일 때만 아래를 검증한다:
  - `kcal`이 `number`가 아니거나 `NaN`이거나 음수면 `TypeError`:
    `` `dayStatus: kcal must be a non-negative number, got ${JSON.stringify(kcal)}` `` (NaN이면 `got NaN`)
  - `targetKcal`이 `number`가 아니거나 `NaN`이거나 **0 이하**면 `TypeError`:
    `` `dayStatus: targetKcal must be a positive number, got ${JSON.stringify(targetKcal)}` `` (NaN이면 `got NaN`)
    (0으로 나누기 방지 — 목표 칼로리가 0 이하인 건 애초에 잘못된 프로필이다)

**경계 케이스 (테스트 필수):**

- 비율 정확히 `0.9` → `'ok'` (미만이 아니라 이상이므로 경계 포함)
- 비율 정확히 `1.1` → `'ok'` (경계 포함)
- 비율 `0.899...` → `'under'`
- 비율 `1.100...1` → `'over'`
- `kcal: 0, hasRecord: true` → 비율 0 → `'under'`
- `hasRecord: false` — `kcal`/`targetKcal`이 `undefined`여도 `'none'` 반환하고 안 던지는지

## 테스트

`tests/calendarGrid.test.js`. `node:test` + `node:assert/strict`.

**금지:** 실제 음식/사용자 데이터 없음 — 이 발주엔 해당 없는 규칙이지만 습관상 명시.
합성 날짜·숫자만 쓴다.

## 완료 조건

- `npm test` 전체 통과 (기존 39개 + 신규)

## 완료 보고

`../../AGENTS.md`의 「완료 보고 형식」대로. `npm test` **실제 출력**을 붙인다.

## 판단이 필요하면

멈추고 묻는다. 특히 이 문서에 없는 입력(예: `weekStartsOn` 외 다른 시작 기준)을 요구받았을 때.
