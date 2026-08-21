# 발주31 — 다중입력 후보 판정 추출 (`resolveMultiCandidates`)

- **워크트리**: `.worktrees/meal-calendar/adhoc-1` (브랜치 `codex/adhoc-1`)
- **등급**: 자동 (순수 함수 + 수용 기준 전부 실행 가능)
- **잡는 파일**: `public/app.js` · `src/lib/multiCandidate.js`(신규) · `tests/multiCandidate.test.js`(신규)
  이 발주가 **`public/app.js` 를 독점**한다. 다른 발주는 이 파일을 건드리지 않는다

## 왜

`public/app.js:1481` 의 `resolveMultiCandidates` 는 **다중입력이 자동 기록될지 말지를 정하는
판정 로직**인데 **테스트가 0건**이다(`grep -rln resolveMultiCandidates tests/` → 없음).
엉뚱한 식품의 숫자가 기록되는 걸 막는 자리라 회귀가 나면 조용히 틀린 값이 저장된다.

순수 함수인데 DOM 파일 안에 있어서 테스트가 못 붙는다. **동작을 바꾸지 말고 그대로 옮긴다.**

## 할 일

`public/app.js` 의 `resolveMultiCandidates` 를 `src/lib/multiCandidate.js` 로 옮기고,
`app.js` 는 import 해서 쓴다. **로직을 바꾸지 않는다** — 이름만 단수로 바꾼다.

```js
// src/lib/multiCandidate.js
import { scaleNutrients } from './units.js';
import { selectBestFood, hasNameMatch } from './quickFoodInput.js';

export function resolveMultiCandidate(piece, items) { ... }
```

`app.js` 쪽:

```js
import { resolveMultiCandidate } from '/src/lib/multiCandidate.js';
// 호출부의 이름도 resolveMultiCandidate 로 바꾼다 (호출은 1곳: resolveMultiPieces 안)
```

> `quickFoodInput.js` 가 `selectBestFood`·`hasNameMatch` 를 실제로 export 하는지 먼저 확인한다.
> 안 하면 **거기까지가 이 발주 범위다** — export 를 추가한다. 그 외 파일은 건드리지 않는다.

## 입출력 명세

### 시그니처

```
resolveMultiCandidate(piece, items) -> Result
```

| 인자 | 형태 |
|---|---|
| `piece` | `{ text: string, parsed: QuickInput }` |
| `piece.parsed` | `{ ok: boolean, query: string, amountG?: number, count?: number, ... }` |
| `items` | 검색 결과 배열. 각 원소 `{ name, per100g, serving?: { amount: number } }` |

### 규칙 (순서대로 판정한다)

| # | 조건 | 결과 |
|---|---|---|
| R1 | `items.length === 0` **또는** `hasNameMatch(piece.parsed.query, items) === false` | `{ text: piece.text, ok: false }` — **다른 키를 넣지 않는다** |
| R2 | 통과하면 | `food = selectBestFood(piece.parsed.query, items)` |
| R3 | `piece.parsed.ok === true` | `amountG = piece.parsed.amountG`, `quickInput = piece.parsed` (**그대로. 복사하지 않는다 — 동일 참조**) |
| R4a | `piece.parsed.ok === false` **그리고** `food.serving` 이 falsy | `{ text: piece.text, ok: false }` |
| R4b | `piece.parsed.ok === false` **그리고** `Number.isFinite(count) === false` 또는 `count <= 0` | `{ text: piece.text, ok: false }` |
| R4c | 그 외 (`ok === false`, serving 있음, count 양수 유한) | `amountG = food.serving.amount * count`, `quickInput = { ...piece.parsed, ok: true, amountG, displayAmount: \`${count}개\`, estimated: true, servingSource: 'mfds-serving' }` |
| R5 | 항상 | `scaled = scaleNutrients(food.per100g, amountG)`, `incomplete = Object.values(scaled).some(v => v === null)` |

### 성공 시 반환 (R5 까지 왔을 때)

```js
{
  text: piece.text,
  ok: true,
  incomplete,
  food,
  amountG,
  quickInput,
  kcal: scaled.kcal,
  name: quickInput.query ?? food.name,
  displayAmount: quickInput.estimated ? quickInput.displayAmount : `${amountG}g`,
  estimated: Boolean(quickInput.estimated),
}
```

### 못박아 두는 것 — 여기서 어긋나면 회귀다

| 항목 | 기대 동작 |
|---|---|
| **반올림** | **하지 않는다.** `amountG` 도 `kcal` 도 계산된 값 그대로. `food.serving.amount * count` 가 `112.5` 면 `112.5` 다 |
| **단위** | `amountG` 는 g. `displayAmount` 는 문자열이고 단위 표기까지 포함한다 |
| **`name` 의 `??`** | `??` 는 `null`·`undefined` 에만 반응한다. `quickInput.query === ''` 면 **빈 문자열 그대로** 반환한다 (`food.name` 으로 안 넘어간다) |
| **`count === 0`** | `0 <= 0` 이라 **R4b 로 거짓**. `ok: false` |
| **`count === -2`** | R4b. `ok: false` |
| **`count === NaN`** | `Number.isFinite(NaN) === false` → R4b. `ok: false` |
| **`count === undefined`** | R4b. `ok: false` |
| **실패 반환의 모양** | `{ text, ok: false }` **두 키만.** `food`·`amountG` 등을 붙이지 않는다 |
| **`estimated`** | `Boolean(quickInput.estimated)` — R3 경로에서 `parsed.estimated` 가 없으면 `false` |
| **타임존** | 이 함수는 시간을 안 만진다. `Date` 를 새로 넣지 않는다 |
| **에러 메시지에 NaN** | 이 함수는 던지지 않는다. 만약 진단 문자열을 넣게 되면 `JSON.stringify(NaN)` 을 쓰지 마라 — 그건 `"null"` 을 반환해서 실제 `null` 처럼 보인다. 리터럴 `'NaN'` 을 쓴다 |

## 테스트

`tests/multiCandidate.test.js` — **명세에서 유도한다. 구현을 보고 베끼지 않는다.**
`items` 는 픽스처로 직접 만든다(네트워크 없음).

최소한 아래를 덮는다. 각 규칙에 최소 1건:

- R1: `items` 가 빈 배열 / `hasNameMatch` 가 false 인 이름
- R3: `parsed.ok === true` 인 정상 경로 — `displayAmount` 가 `` `${amountG}g` `` 인지
- R4a: `food.serving` 없음
- R4b: `count` 가 `0` · 음수 · `NaN` · `undefined` — **4건 전부**
- R4c: `serving.amount * count` 계산, `displayAmount === '2개'`, `estimated === true`, `servingSource === 'mfds-serving'`
- R5: `per100g` 에 `null` 이 섞였을 때 `incomplete === true`, 안 섞였을 때 `false`
- 경계: `serving.amount` 가 소수라 `amountG` 가 소수로 나오는 경우 — **반올림 안 하는 것**을 확인
- 경계: `quickInput.query === ''` → `name === ''`
- 실패 반환에 `food` 키가 **없는지** (`'food' in result === false`)

## 수용 기준 (Codex 가 돌리고 출력 그대로 붙인다)

```
1. node --test tests/multiCandidate.test.js
   → 전부 통과, fail 0

2. npm test
   → pass 548 이상, fail 0  (기존 회귀 없음. skip 1 은 에뮬레이터 전용이라 정상)

3. grep -c "function resolveMultiCandidates" public/app.js
   → 0   (원본이 남아 있으면 안 된다)

4. grep -n "multiCandidate.js" public/app.js
   → import 1줄

5. git diff --stat
   → public/app.js · src/lib/multiCandidate.js · tests/multiCandidate.test.js
     · docs/NEXT.md
     (quickFoodInput.js 의 export 추가가 필요했으면 그것까지 5개. 그 외 파일이 있으면 실패)
```

> `docs/NEXT.md` 는 `AGENTS.md:150`(「작업 시작 전과 끝난 후 '작업 분담 현황' 을
> 갱신한다」)이 요구하는 것이라 허용 목록에 들어간다. 처음 발주 때 이걸 빠뜨려서
> **두 규칙이 서로를 부쉈고, Codex 가 옳게 지적하고 멈췄다**(2026-08-21).
> 갱신 범위는 「작업 분담 현황」 표의 이 발주 행뿐이다 — 다른 절을 고치면 실패.

## 안 하는 것

- 로직 개선·리팩터 **금지.** 옮기기만 한다. 개선점이 보이면 **보고만** 한다
- `app.js` 의 다른 부분을 건드리지 않는다 (이 함수와 그 호출 1곳, import 1줄만)
- 의존성 추가 **금지**
