# 발주 14 — 체중 추세 계산 (순수 로직)

## 배경

Phase 5(체중 + 추이)가 v1 의 마지막 조각이다. `ROADMAP.md` 는 **「체중이 유일한 결과 지표다」**
라고 못박고 있다 — 매크로 추이 차트는 만들지 않는다.

`weightKg` 는 이미 하루 문서(`users/{uid}/days/{YYYY-MM-DD}`)에 저장되는 필드다.
**입력 UI 와 화면은 Claude 몫이고, 이 발주는 계산만 만든다.**

> **절대규칙 3 — 건강 조언을 하지 않는다.**
> 이 파일은 **산술만** 한다. "감량 속도가 빠르니 줄이세요" 같은 판단·권고 문구를
> 반환하지 않는다. 방향과 수치만 돌려주고, 해석은 사람이 한다.

## 만들 파일

- `src/lib/weightTrend.js` (신규)
- `tests/weightTrend.test.js` (신규)

기존 `src/lib/dayTotals.js`, `src/lib/calendarGrid.js` 스타일을 따른다
(ESM export, 한국어 주석, `TypeError`/`Error` 로 거부, 에러 메시지에 어떤 값이었는지 포함).

## 입력 형태

```js
[{ date: 'YYYY-MM-DD', weightKg: 71.2 }, ...]
```

- **정렬돼 있다고 가정하지 않는다.** 함수가 날짜순으로 정렬해서 쓴다
- **날짜가 비어 있는 게 정상이다.** 체중을 매일 재지 않는다
- 날짜는 로컬 날짜 문자열이다 (절대규칙 5). **`Date` 로 파싱해 타임존을 타지 않는다** —
  `YYYY-MM-DD` 를 문자열로 비교·정렬하고, 일수 차이는 정오(12시)로 고정해 계산한다
  (`new Date(y, m-1, d, 12)` — DST 경계에서 하루가 밀리지 않는다. `db.js` 의 `shiftDate` 와 같은 방식)

## 공통 입력 검증

모든 함수가 동일하게 적용한다.

| 상황 | 동작 |
|---|---|
| 인자가 배열이 아님 | `TypeError` |
| 원소가 객체가 아님 | `TypeError` |
| `date` 가 `/^\d{4}-\d{2}-\d{2}$/` 에 안 맞음 | `Error` (메시지에 그 값 포함) |
| `weightKg` 가 숫자가 아님 | `TypeError` |
| `weightKg` 가 `NaN` | `Error` — 메시지에 **리터럴 `NaN`** 을 쓴다. `JSON.stringify(NaN)` 은 `"null"` 을 반환한다 |
| `weightKg` <= 0 | `Error` |
| 같은 `date` 가 두 번 | **뒤엣것을 쓴다** (나중 기록이 정정이다). 던지지 않는다 |

---

# 1. `movingAverageKg(points, windowDays)`

체중은 하루 단위로 요동친다(수분·식사). **이동평균이 실제 추세다.**

```js
export function movingAverageKg(points, windowDays)
// → [{ date, avgKg, sampleCount }]  — 입력에 있는 날짜마다 한 개, 날짜 오름차순
```

각 날짜 `d` 에 대해, **`d` 를 포함해 과거 `windowDays` 일 이내**의 표본으로 평균을 낸다.
(즉 구간은 `d - (windowDays-1)` ~ `d`, 양끝 포함.)

- 없는 날은 **건너뛴다.** 0 으로 채우지 않는다 — 안 잰 날을 0kg 으로 치면 평균이 무너진다
- `sampleCount` 는 그 창에 실제로 들어간 표본 수다. **화면이 신뢰도를 표시할 수 있게 노출한다**
- `avgKg` 는 **소수 첫째 자리 반올림** (`Math.round(x * 10) / 10`)

| 입력 | 반환 |
|---|---|
| `[]`, 아무 window | `[]` |
| `[{d:'2026-08-01',70}]`, `7` | `[{date:'2026-08-01', avgKg:70, sampleCount:1}]` |
| `[01:70, 02:72]`, `7` | `[{01,70,1},{02,71,2}]` |
| `[01:70, 08:72]`, `7` | `[{01,70,1},{08,72,1}]` — 8일차 창(02~08)에 01 은 안 들어간다 |
| `[02:72, 01:70]` (역순 입력), `7` | `[{01,70,1},{02,71,2}]` — 정렬해서 처리 |
| `windowDays` 가 정수가 아니거나 `< 1` | `Error` |

# 2. `weeklyChangeKg(points)`

주당 몇 kg 변하는지. **최소제곱 선형회귀 기울기**(kg/일)에 7을 곱한다.
단순히 (마지막 − 처음)/주수 로 하지 않는다 — 그건 양끝 표본 하나에 통째로 휘둘린다.

```js
export function weeklyChangeKg(points)
// → { kgPerWeek, spanDays, sampleCount } | null
```

- `x` 는 **첫 표본 날짜로부터의 일수**, `y` 는 `weightKg`
- `kgPerWeek` 는 **소수 둘째 자리 반올림** (`Math.round(x * 100) / 100`)
- `spanDays` 는 첫 표본과 마지막 표본의 날짜 차이(일)
- 감량이면 **음수**다

| 조건 | 반환 |
|---|---|
| 표본 0개 또는 1개 | `null` — 기울기를 낼 수 없다 |
| 모든 표본이 **같은 날짜** (`spanDays === 0`) | `null` — 0 으로 나눈다. **0 을 반환하지 않는다** |
| 표본 2개, 7일 간격, 70→69 | `{ kgPerWeek: -1, spanDays: 7, sampleCount: 2 }` |
| 표본 2개, 14일 간격, 70→68 | `{ kgPerWeek: -1, spanDays: 14, sampleCount: 2 }` |
| 모든 체중이 동일 | `kgPerWeek: 0` (기울기 0 은 정상값이다) |

**`null` 과 `0` 을 구분하는 게 이 함수의 핵심이다.**
「변화 없음(0)」과 「알 수 없음(null)」은 다르다 — 후자를 0 으로 뭉개면
화면이 "체중 변화 없음"이라고 거짓말한다 (절대규칙 7).

# 3. `summarizeWeightTrend(points, options)`

```js
export function summarizeWeightTrend(points, options)
// options: { flatThresholdKgPerWeek = 0.1 } — 기본값 있음, 생략 가능
// → { direction, kgPerWeek, spanDays, sampleCount, latestKg, latestDate }
```

`direction` 판정:

| 조건 | `direction` |
|---|---|
| `weeklyChangeKg` 가 `null` | `'unknown'` |
| `kgPerWeek <= -flatThreshold` | `'down'` |
| `kgPerWeek >= +flatThreshold` | `'up'` |
| 그 사이 | `'flat'` |

- 경계는 **포함**이다. 임계값 `0.1` 에서 `kgPerWeek === -0.1` 이면 `'down'`
- `direction === 'unknown'` 이면 `kgPerWeek`·`spanDays` 는 `null` 이다
- `latestKg`/`latestDate` 는 **날짜가 가장 늦은 표본**. 표본이 없으면 둘 다 `null`
- `flatThresholdKgPerWeek` 가 숫자가 아니거나 음수면 `Error`

**판단 문구를 반환하지 않는다.** `'감량 중'` 같은 한국어 라벨은 화면이 붙인다 —
이 함수는 `'down'` 만 돌려준다.

---

## 테스트 요구사항

- **위 모든 표의 모든 행**을 테스트한다
- 경계값 필수: 표본 **0·1·2개**, `spanDays === 0`, 임계값 **정확히 경계**(`-0.1`, `0.1`),
  `windowDays === 1`, 역순 입력, 같은 날짜 중복
- **`null` vs `0` 구분**을 명시적으로 잠근다 (`weeklyChangeKg`)
- **결측일이 평균을 망가뜨리지 않는지** 잠근다 — 중간이 빈 데이터로 이동평균을 내고
  `sampleCount` 가 맞는지 확인
- 체중 숫자는 **이 발주서 표의 값이거나 테스트가 직접 만든 합성값**이다.
  실제 사람 체중을 지어내 쓰지 않는다
- `Error`/`TypeError` 는 `assert.throws` 로 잠근다
- 테스트는 표에서 유도한다. 구현을 읽고 베끼지 않는다

## 수용 기준

```bash
npm test                        # 기준선 169개. 새 테스트만큼 늘어야 한다
node scripts/verify-mfds.mjs    # 회귀 없음 확인 (파서를 안 건드리므로 그대로여야 한다)
```

## 하지 말 것

- 의존성 추가 금지 · 네트워크 호출 금지 (`src/lib/` 는 순수하다)
- `Math.random()` 금지 (절대규칙 4)
- **건강 조언·권고 문구 금지** (절대규칙 3). 방향과 수치만
- `functions/`, `public/`, 다른 `src/lib/*` 를 건드리지 말 것
- 표에 없는 규칙을 지어내지 말 것 — 비었으면 채우지 말고 보고한다
- **커밋하지 말 것**
