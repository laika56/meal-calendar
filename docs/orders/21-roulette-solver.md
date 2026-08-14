# 발주 21 — AI 룰렛 solver (순수 로직)

## 배경

Phase 6. `docs/SPEC.md` 「AI 스마트 룰렛」이 원 스펙이고, 이 발주는 그걸 테스트 가능한
정확한 알고리즘으로 못박은 것이다. 후보 풀은 **프리셋 + 최근 항목**이다 — 식약처 DB 전체를
뒤지지 않는다. 그래서 작고 빠른 문제다.

**결과는 제안이다.** 자동 확정하지 않는다. 화면·수락 흐름은 Claude 가 만든다.

## 만들 / 고칠 파일

- `src/lib/roulette.js` (신규)
- `tests/roulette.test.js` (신규)

`src/lib/dayTotals.js` 의 `sumEntries(entries)` 를 **재사용한다** — 콤보의 매크로 합산을
새로 만들지 않는다. import 해서 쓴다.

## 절대규칙과의 관계

- **규칙 4(무작위성은 시드를 통과한다):** `Math.random()` 을 호출하지 않는다.
  아래 지정된 시드 PRNG 만 쓴다
- **규칙 7(퇴화 케이스를 조용히 뭉개지 않는다):** 후보가 부족하면 빈 슬롯으로 **그대로 보고**한다.
  억지로 채우지 않는다
- **규칙 2(영양 숫자를 지어내지 않는다):** 이 파일은 후보의 기존 매크로를 조합만 한다.
  스케일링(양을 늘리거나 줄이는 계산)을 하지 않는다 — 프리셋·최근 항목은 이미 고정된 양의
  기록이라 임의로 늘리면 그 순간 지어낸 숫자가 된다

---

# 1. `createSeededRandom(seed)`

**mulberry32.** 아래 구현을 **그대로** 옮긴다 — 다른 PRNG 를 쓰지 않는다.
같은 시드면 어떤 JS 엔진에서도 같은 수열이 나와야 재현성이 성립한다.

```js
export function createSeededRandom(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError(`createSeededRandom: seed must be a finite number, got ${JSON.stringify(seed)}`);
  }
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

테스트는 **정확한 출력값을 단언하지 않는다** (PRNG 내부를 재구현해서 검산하는 게 아니라
코드를 그대로 옮기는 것이므로). 대신 성질을 잠근다:
- 반환값이 항상 `[0, 1)` 구간
- 같은 시드로 새로 만든 두 인스턴스가 **같은 수열**을 낸다 (5번 호출해서 배열로 비교)
- 시드가 다르면 (일반적으로) 다른 수열이 나온다 — 시드 `1`과 `2`로 확인
- `seed` 가 숫자가 아니면 `TypeError`

---

# 2. `computeSlotTargets(remainingMacros, emptySlots)`

빈 슬롯에 잔여 매크로를 비중대로 나눈다.

```js
export const SLOT_RATIOS = { breakfast: 25, lunch: 35, dinner: 30, snack: 10 };

export function computeSlotTargets(remainingMacros, emptySlots)
// → { [slotKey]: { kcal, carbG, proteinG, fatG } }
```

- `remainingMacros`: `{ kcal, carbG, proteinG, fatG }`, 전부 숫자. 음수여도 이 함수는 그대로 계산한다
  (음수 거부는 3번 `buildRouletteProposal` 이 한다 — 이 함수는 순수 산술만)
- `emptySlots`: `['breakfast'|'lunch'|'dinner'|'snack', ...]`, 중복 없음
- **비중은 `emptySlots` 안에서만 재정규화한다.** 채워진 슬롯의 비중은 버린다
- `kcal` 은 `Math.round` (정수), 그 외 세 필드는 `Math.round(x * 10) / 10` (소수 1자리) —
  `dayTotals.js` 의 반올림 관례와 같다

### 예시로 잠글 것 (직접 계산해서 검증된 값)

`remainingMacros = { kcal: 800, carbG: 100, proteinG: 60, fatG: 20 }`,
`emptySlots = ['breakfast', 'snack']` (아침·간식 빔, 점심·저녁 이미 기록됨)

빈 슬롯 비중 합 = 25 + 10 = 35. breakfast 비중 = 25/35, snack 비중 = 10/35.

| slot | kcal | carbG | proteinG | fatG |
|---|---|---|---|---|
| breakfast | 571 | 71.4 | 42.9 | 14.3 |
| snack | 229 | 28.6 | 17.1 | 5.7 |

- `emptySlots` 가 빈 배열이면 `{}` 반환
- `emptySlots` 에 없는 키가 있으면(`'breakfast'|'lunch'|'dinner'|'snack'` 아님) `Error`
- `remainingMacros` 의 필드가 숫자가 아니면 `TypeError`

---

# 3. `scoreCombo(comboMacros, target)`

콤보가 목표에 얼마나 가까운지. **낮을수록 좋다.**

```js
export function scoreCombo(comboMacros, target)
// comboMacros, target: { kcal, carbG, proteinG, fatG }
// → number (0 이상)
```

네 필드 각각에 대해 상대오차를 구하고 제곱해서 더한다:

```
relErr(actual, target) =
  target > 0 ?  (actual - target) / target
             :  (actual > 0 ? 1 : 0)

score = relErr(kcal)² + relErr(carbG)² + relErr(proteinG)² + relErr(fatG)²
```

### 예시로 잠글 것 (직접 계산해서 검증된 값)

target = `{ kcal: 250, carbG: 20, proteinG: 20, fatG: 8 }`

| comboMacros | score |
|---|---|
| `{0,0,0,0}` | `4` |
| `{150,2,12,10}` | `1.1925` |
| `{250,7,27,12}` | `0.795` |
| `{240,25,13,10}` | `0.2491` |
| `{190,28,16,2}` | `0.8201` |

(계산 검증: 예를 들어 `{240,25,13,10}` → kcal `(240-250)/250=-0.04→0.0016`,
carb `(25-20)/20=0.25→0.0625`, protein `(13-20)/20=-0.35→0.1225`,
fat `(10-8)/8=0.25→0.0625` → 합 `0.2491`.)

- `target` 의 한 필드가 `0` 이고 `comboMacros` 의 그 필드도 `0` 이면 그 항의 기여는 `0`
- 숫자가 아닌 필드가 있으면 `TypeError`

---

# 4. `rankSlotCombos(candidates, target, maxItemsPerSlot)`

한 슬롯에 넣을 수 있는 **모든 조합**을 만들고 점수순으로 정렬한다.

```js
export function rankSlotCombos(candidates, target, maxItemsPerSlot)
// candidates: [{ id, label, entries, macros, recencyPenalty }]
//   macros = sumEntries(entries) 를 호출부가 미리 계산해서 넣어둔 것 (이 함수는 재계산하지 않는다)
//   recencyPenalty: 0 이상 숫자. 최근 먹은 것일수록 크다 (5번 참조)
// → [{ entries, macros, score, comboIds }]   score 오름차순, 동점이면 candidates 순서를 따른다
```

- **크기 0(빈 조합)부터 `maxItemsPerSlot`까지** 모든 부분집합을 만든다.
  같은 candidate 를 한 조합 안에서 두 번 쓰지 않는다 (조합, 순열 아님)
- 빈 조합의 `macros` 는 `{kcal:0,carbG:0,proteinG:0,fatG:0}`, `entries` 는 `[]`, `comboIds` 는 `[]`
- 조합의 `score` = `scoreCombo(합산 macros, target)` + `그 조합에 든 candidate 들의 recencyPenalty 합`.
  **penalty 는 점수에 더하는 것이지 별도 정렬 키가 아니다** — 벌점이 큰 후보가 든 조합은
  그만큼 순위가 밀린다
- `comboIds` 는 그 조합에 든 candidate 의 `id` 배열, **candidates 순서대로**
- `maxItemsPerSlot` 이 0 이면 빈 조합 하나만 반환한다
- `candidates` 가 빈 배열이면 빈 조합 하나만 반환한다
- `maxItemsPerSlot` 이 음수거나 정수가 아니면 `Error`

### 예시로 잠글 것

`candidates` (id/label/macros만 표기, `recencyPenalty: 0` 전부):
```
A 계란찜:   { kcal:150, carbG:2,  proteinG:12, fatG:10 }
B 그릭요거트: { kcal:100, carbG:5,  proteinG:15, fatG:2  }
D 바나나:   { kcal:90,  carbG:23, proteinG:1,  fatG:0  }
```
`target = { kcal: 250, carbG: 20, proteinG: 20, fatG: 8 }`, `maxItemsPerSlot = 2`

7개 조합(`{}`,`{A}`,`{B}`,`{D}`,`{A,B}`,`{A,D}`,`{B,D}`)이 나오고, 점수 오름차순 정렬은:

```
1. {A,D}  score 0.2491
2. {A,B}  score 0.795
3. {B,D}  score 0.8201
4. {A}    score 1.1925
5. {B}    score 1.5475
6. {D}    score 2.3346
7. {}     score 4
```

**이 순위를 정확히 그대로 재현하는 테스트를 넣는다.** (합산 macros 값도 위 3번 섹션 표와 일치해야 한다.)

---

# 5. `buildCandidatePool(presets, recentEntries)`

Firestore 원본이 아니라 **호출부가 이미 정리한 배열**을 받는다 (이 파일은 순수하다).

```js
export function buildCandidatePool(presets, recentEntries)
// presets:      [{ id, label, entries }]   entries 는 하루 기록과 같은 형태(kcal 등 포함)
// recentEntries: [entry, ...]              최신순 (index 0 이 가장 최근), 최대 10개
// → [{ id, label, entries, macros, recencyPenalty }]
```

- 프리셋 하나당 candidate 하나: `id = 'preset_' + preset.id`, `label = preset.label`,
  `entries = preset.entries`, `macros = sumEntries(preset.entries)`, `recencyPenalty = 0`
  (저장해둔 조합은 재사용 의도가 있으므로 최근성 벌점을 매기지 않는다)
- 최근 항목 하나당 candidate 하나: `id = 'recent_' + index` (그 배열에서의 인덱스),
  `label = entry.name`, `entries = [entry]`, `macros = sumEntries([entry])`,
  `recencyPenalty` 는 6번 공식으로 계산
- `presets` 또는 `recentEntries` 가 배열이 아니면 `TypeError`
- 둘 다 빈 배열이면 빈 배열 반환

# 6. 최근성 벌점 공식

`recentEntries` 에서 인덱스 `i` (0 = 가장 최근), 배열 길이 `n` 일 때:

```
recencyPenalty(i, n) = n > 0 ? RECENCY_WEIGHT * (1 - i / n) : 0
```

`export const RECENCY_WEIGHT = 0.2;` 로 상수를 뽑아 export 한다.

| `i` | `n` | penalty |
|---|---|---|
| 0 | 10 | `0.2` |
| 5 | 10 | `0.1` |
| 9 | 10 | `0.02` |
| 0 | 1 | `0.2` |

---

# 7. `pickFromTopK(rankedCombos, k, random)`

정렬된 순위에서 상위 K개 중 하나를 시드 난수로 고른다. **재현성의 핵심.**

```js
export function pickFromTopK(rankedCombos, k, random)
// rankedCombos: rankSlotCombos() 의 반환
// k: 양의 정수
// random: createSeededRandom(seed) 가 돌려준 함수
// → rankedCombos 의 원소 하나 (얕은 복사 없이 그대로)
```

- 실제로 고려하는 범위는 `min(k, rankedCombos.length)` 개
- `index = Math.floor(random() * min(k, rankedCombos.length))` 로 고른다
- `rankedCombos` 가 빈 배열이면 `Error`
- `k` 가 정수가 아니거나 0 이하면 `Error`

테스트는 성질로 잠근다: 같은 `rankedCombos` + 같은 시드(같은 `random` 함수를 새로 만들어서) →
항상 같은 결과. 반환값이 항상 `rankedCombos.slice(0, min(k,len))` 안에 있다.

---

# 8. `buildRouletteProposal(input)` — 오케스트레이터

```js
export function buildRouletteProposal({
  remainingMacros, emptySlots, candidatePool, dislikes, seed,
  maxItemsPerSlot = 3, topK = 5,
})
// → { ok: true, slots: { [slotKey]: { entries, macros, targetMacros, score } }, filledSlotCount }
//  | { ok: false, reason: 'over-budget' }
//  | { ok: false, reason: 'no-empty-slots' }
```

## 순서

1. `remainingMacros.kcal <= 0` 이면 `{ ok: false, reason: 'over-budget' }`.
   **돌리지 않는다** — SPEC 「잔여 매크로가 음수면 룰렛을 돌리지 않는다」
2. `emptySlots.length === 0` 이면 `{ ok: false, reason: 'no-empty-slots' }`
3. `candidatePool` 에서 `dislikes` 에 걸리는 항목을 뺀다 — candidate 의 `entries` 중
   **하나라도** `foodKey` 가 `dislikes` 배열에 있으면 그 candidate 전체를 제외한다
4. `computeSlotTargets(remainingMacros, emptySlots)` 로 슬롯별 목표를 만든다
5. **`emptySlots` 를 `['breakfast','lunch','dinner','snack']` 순서로 순회한다** (그중 실제로 빈 것만).
   각 슬롯마다:
   - `rankSlotCombos(필터된 후보, 그 슬롯의 target, maxItemsPerSlot)`
   - 슬롯별 시드는 `(seed + slotIndex * 2654435761) >>> 0` 로 만든다.
     `slotIndex` 는 `['breakfast','lunch','dinner','snack']` 에서의 위치(0~3) —
     같은 후보 목록이라도 슬롯마다 다른 수열이 나오게 하기 위해서다
   - `pickFromTopK(순위, topK, createSeededRandom(그 슬롯 시드))` 로 하나 고른다
   - 결과에 `{ entries, macros, targetMacros: target, score }` 로 기록한다.
     **슬롯 간에 같은 candidate 가 중복 선택되는 것은 막지 않는다** (예: 아침·간식에
     같은 요거트가 둘 다 나올 수 있다) — SPEC 에 교차-슬롯 배제 규칙이 없다
6. `filledSlotCount` = 고른 조합의 `entries.length > 0` 인 슬롯 수 (빈 조합으로 끝난 슬롯은 안 셈)
7. `{ ok: true, slots, filledSlotCount }` 반환

## 지켜야 할 것

- `candidatePool` 이 빈 배열이거나 필터 후 남는 게 없어도 **던지지 않는다.**
  모든 슬롯이 빈 조합(`entries: []`)으로 끝나고 `filledSlotCount: 0` 이 된다 —
  이게 SPEC 의 「후보가 부족하면 억지로 채우지 않는다」다
- `seed` 가 숫자가 아니면 `TypeError`
- `dislikes` 가 없거나 빈 배열이면 필터링 없이 진행

---

## 테스트 요구사항

- **위 모든 섹션의 모든 표/예시를 그대로 재현하는 테스트**를 넣는다. 표가 정답이다
- 2번 함수: 위 표의 값 정확히
- 3번 함수: 위 표의 5개 score 정확히
- 4번 함수: 위 정렬 순서와 각 조합의 macros 정확히
- 6번: 벌점 표 4행
- `buildRouletteProposal`:
  - `remainingMacros.kcal = 0` 과 `-1` 둘 다 `over-budget`
  - `emptySlots: []` → `no-empty-slots`
  - `dislikes` 에 걸린 candidate 가 결과에 전혀 안 나타나는지
  - **candidatePool 이 빈 배열이어도 전체가 성공(`ok:true`)하고 모든 슬롯이 빈 조합인지**
    (절대규칙 7 검증)
  - 같은 `seed` 로 두 번 호출하면 **완전히 같은 결과**가 나오는지 (JSON 문자열 비교)
- 경계값: `emptySlots` 1개, 4개, `maxItemsPerSlot: 0`, `topK`가 후보 수보다 큰 경우
- `TypeError`/`Error` 는 `assert.throws` 로 잠근다
- 테스트는 표에서 유도한다. 구현을 읽고 베끼지 않는다

## 수용 기준

```bash
npm test                             # 기준선 229개
node scripts/check-shared-sync.mjs   # 이 파일은 functions/ 에서 안 쓰므로 영향 없음. 그래도 돌린다
```

## 하지 말 것

- 의존성 추가 금지 · 네트워크 호출 금지 · `Math.random()` 금지
- **후보의 양(g)을 스케일링하지 않는다.** 조합만 한다 — 절대규칙 2
- `src/lib/dayTotals.js` 의 `sumEntries` 를 다시 구현하지 말 것. import 해서 쓴다
- `functions/`, `public/` 을 건드리지 말 것 — UI·수락 흐름은 Claude 가 만든다
- LLM 설명 문구 생성(SPEC 5번, 선택 기능)은 이 발주 범위가 아니다
- 표에 없는 규칙을 지어내지 말 것 — 비었으면 채우지 말고 보고한다
- **커밋하지 말 것**
