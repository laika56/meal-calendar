# 발주 25 — 후보 풀이 커지면 조합 탐색이 폭발한다, 미리 자른다

## 왜

발주 23이 룰렛 후보 풀에 검색 캐시(`foods/`) 전체를 얹었다. 지금까지는 후보가
프리셋+최근항목뿐이라 많아야 10~20개였는데, 캐시가 쌓이면 수백 개가 될 수 있다.

`rankSlotCombos`(이미 있음, `src/lib/roulette.js`)는 `combinationsOfSize`로 **완전
조합 탐색**을 한다 — 후보 n개, 슬롯당 최대 `maxItemsPerSlot`(기본 3)개를 뽑을 때
`C(n,0)+C(n,1)+C(n,2)+C(n,3)`개를 전부 계산한다. `n=15`면 몇백 개라 순식간이지만,
`n=200`이면 슬롯 하나당 130만 개 이상이다. 4개 슬롯(아침/점심/저녁/간식) 매번
이걸 하면 폰에서 화면이 멎는다.

**아직 실제로 터진 버그는 아니다** — `app.js`가 캐시를 룰렛에 실제로 연결하는 건
Claude 몫이고 아직 안 했다. 그게 붙기 전에 미리 막아두는 발주다.

## 만들 것

`src/lib/roulette.js`에 새 함수 하나 추가 + `buildRouletteProposal` 안쪽 한 줄만 고친다.

### 1. 새 함수 `capCandidatePoolSize(candidates, target, maxSize)`

```js
export function capCandidatePoolSize(candidates, target, maxSize) { ... }
```

- `candidates`: `Array<Candidate>` — `buildCandidatePool`/`buildCachedFoodCandidates`가
  만드는 것과 같은 모양(`{ id, label, entries, macros, recencyPenalty }`)
- `target`: 매크로 목표 객체 `{ kcal, carbG, proteinG, fatG }` — 파일 안에 이미 있는
  `validateMacros(macros, functionName, argumentName)`로 검증한다(새로 만들지 않는다)
- `maxSize`: 양의 정수. 아니면 `TypeError`
  (`capCandidatePoolSize: maxSize must be a positive integer, got ...`)

**동작:**

1. `candidates.length <= maxSize`면 **입력을 그대로, 순서도 안 바꾸고 반환한다.**
   (이게 핵심이다 — 지금 있는 작은 후보 풀에서는 이 함수가 사실상 없는 것처럼 동작해야
   기존 테스트가 하나도 안 깨진다.)
2. `candidates.length > maxSize`면, **각 후보의 `|macros.kcal - target.kcal|`(목표
   칼로리와의 절댓값 차이)가 작은 순으로 정렬해서 앞의 `maxSize`개만 남긴다.**
   - 차이가 같으면 **원래 배열에서 먼저 나온 것**을 앞에 둔다(원본 인덱스로 안정 정렬 —
     `Array.prototype.sort`의 콜백에 원본 인덱스를 함께 써서 동점을 명시적으로 처리한다,
     엔진의 정렬 안정성에 기대지 않는다).
   - 반환 순서는 **거리가 가까운 순**이다(원본 순서로 되돌리지 않는다).

### 2. `buildRouletteProposal` 안에서 부르기

지금 이 줄 바로 앞에:

```js
const ranked = rankSlotCombos(filteredCandidates, targets[slot], maxItemsPerSlot);
```

이렇게 바꾼다:

```js
const cappedCandidates = capCandidatePoolSize(filteredCandidates, targets[slot], maxCandidatePoolSize);
const ranked = rankSlotCombos(cappedCandidates, targets[slot], maxItemsPerSlot);
```

그리고 `buildRouletteProposal`의 옵션 인자에 기본값 있는 새 파라미터를 하나 추가한다:

```js
export function buildRouletteProposal({
  remainingMacros,
  emptySlots,
  candidatePool,
  dislikes,
  seed,
  maxItemsPerSlot = 3,
  topK = 5,
  maxCandidatePoolSize = 30,   // 추가
}) {
```

**`30`이라는 기본값을 근거 없이 다른 값으로 바꾸지 않는다.** 기존 테스트 픽스처가
전부 그보다 작은 후보 풀을 쓰므로, 이 기본값에서는 캡이 걸리지 않고
`buildRouletteProposal`의 기존 테스트가 전부 한 글자도 안 바뀌고 통과해야 한다.

## 예시 입출력

```js
const target = { kcal: 250, carbG: 20, proteinG: 20, fatG: 8 };

const near = { id: 'A', label: '가까움', entries: [...], macros: { kcal: 240, carbG: 20, proteinG: 20, fatG: 8 }, recencyPenalty: 0 };
const mid  = { id: 'B', label: '중간',   entries: [...], macros: { kcal: 100, carbG: 10, proteinG: 5,  fatG: 2 }, recencyPenalty: 0 };
const far  = { id: 'C', label: '멀음',   entries: [...], macros: { kcal: 900, carbG: 90, proteinG: 50, fatG: 30}, recencyPenalty: 0 };

capCandidatePoolSize([mid, far, near], target, 2);
// → [near, mid]
//   거리: near=|240-250|=10, mid=|100-250|=150, far=|900-250|=650
//   가까운 순 2개만, 원래 배열 순서(mid, far, near)와 무관하게 거리순으로 재배열됨
```

```js
capCandidatePoolSize([near, mid], target, 5);
// → [near, mid]  (그대로, 순서도 그대로 — 2 <= 5 라서 손 안 댐)
```

## 경계 케이스 — 테스트로 잠근다

- 후보 수가 `maxSize`보다 적음 → 순서·내용 전부 그대로 반환
- 후보 수가 `maxSize`와 정확히 같음 → 그대로 반환 (자르지 않음)
- 후보 수가 `maxSize`보다 많음 → 가까운 순으로 정확히 `maxSize`개, 나머지는 버림
- 거리가 동점인 두 후보 → 원본 배열에서 먼저 나온 게 앞에 남음
- `maxSize`가 0이거나 음수이거나 정수가 아님 → `TypeError`
- `candidates`가 빈 배열 → 빈 배열 반환 (`maxSize`가 뭐든)
- `target`이 매크로 형태가 아님 → `validateMacros`가 이미 던지는 에러 그대로 통과시킨다

그리고 `buildRouletteProposal` 쪽 회귀 테스트:

- 기존 `buildRouletteProposal` 테스트 전부 수정 없이 통과 (후보 풀이 30개 미만이므로)
- 후보가 30개 넘는 상황을 새로 만들어서, 슬롯 결과가 여전히 유효한 조합인지
  (매크로가 null 없이 계산되고, `score`가 숫자인지) 확인하는 테스트 최소 1개 추가

## 수용 기준

```bash
npm test
```

전부 통과. `rankSlotCombos`·`buildCandidatePool`·`buildCachedFoodCandidates`는
이 발주에서 안 건드린다 — 건드렸다면 범위를 벗어난 것이다.
