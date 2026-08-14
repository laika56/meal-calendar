# 발주 23 — 룰렛 후보 풀에 검색 캐시 전체를 얹는다

## 왜

지금 룰렛 후보는 프리셋 + 최근항목뿐이다(`buildCandidatePool`, `src/lib/roulette.js`).
사용자가 "목표 칼로리 내에 모든 메뉴에서 룰렛"을 요청했다 — 프리셋 몇 개로 좁히지 말고
지금까지 검색해서 실제로 본 음식 전부(Firestore `foods/` 캐시)를 후보에 넣으라는 것이다.

**완전히 낯선 음식은 여전히 안 된다.** 원래 프리셋으로 좁혔던 이유가 "안 사놓은 음식을
추천받으면 못 먹는다"였다 — 그 문제는 그대로 남아 있다. 그래서 식약처 DB 전체가 아니라
**한 번이라도 검색된 것**(`foods/` 캐시)까지만 후보로 쓴다.

## 만들 것

`src/lib/roulette.js`에 새 함수 하나만 추가한다. **기존 `buildCandidatePool`은 건드리지
않는다** — 시그니처도 테스트도 그대로 둔다. 호출부(`public/app.js`, Claude 담당, 이 발주
범위 아님)가 두 함수의 결과를 배열로 합쳐서 쓴다.

```js
export function buildCachedFoodCandidates(cachedFoods) { ... }
```

### 입력 — `cachedFoods: Array<CachedFood>`

`CachedFood`는 Firestore `foods/` 문서에서 뽑아온 순수 객체다:

```ts
{
  foodKey: string,       // Firestore 문서 ID. 예: "mfds_D101-004160000-0001"
  name: string,
  per100g: { kcal: number|null, carbG: number|null, proteinG: number|null, fatG: number|null },
  basis: 'g' | 'mL',
  foodGroup: 'dish' | 'processed' | 'ingredient' | 'unknown' | null,
  totalAmount: number | null,
  totalUnit: 'g' | 'mL' | null,
  servingAmount: number | null,
  servingUnit: 'g' | 'mL' | null,
}
```

이 필드들은 `resolveServing`(`src/lib/mfdsParser.js`, 이미 있음)이 그대로 받는 모양과
같다 — `foods/` 캐시 문서 자체가 그 함수 입력을 저장해두려고 그렇게 설계됐다
(`functions/index.js`의 `cacheFoodItems` 주석 참고).

### 처리 순서 (각 항목마다)

1. `resolveServing(food)`를 부른다. **`null`이 나오면 그 항목은 통째로 버린다** —
   1인분을 모르는 음식을 추측해서 넣지 않는다(절대규칙 7, 발주 09~22와 같은 원칙).
2. `null`이 아니면 `scaleNutrients(food.per100g, serving.amount)`
   (`src/lib/units.js`, 이미 있음)로 그 양만큼 환산한다.
3. 환산 결과 `kcal`/`carbG`/`proteinG`/`fatG` 중 **하나라도 `null`이면 그 항목도 버린다**
   — 원본 DB에 영양소 하나가 비어 있는 경우다. 나머지 값으로 대충 채우지 않는다.
4. 살아남은 항목만 아래 모양으로 변환한다.

### 출력 — `Array<Candidate>`

`buildCandidatePool`이 이미 만들어내는 것과 **완전히 같은 모양**이라야 한다
(둘을 배열로 합쳐 쓰기 때문). `tests/roulette.test.js`의 `candidate()` 헬퍼가 만드는
모양을 그대로 따른다:

```js
{
  id: `cache_${food.foodKey}`,
  label: food.name,
  entries: [{
    name: food.name,
    foodKey: food.foodKey,
    kcal: scaled.kcal,
    carbG: scaled.carbG,
    proteinG: scaled.proteinG,
    fatG: scaled.fatG,
  }],
  macros: scaled,          // scaleNutrients 결과 그대로 — { kcal, carbG, proteinG, fatG }
  recencyPenalty: 0,       // 최근항목이 아니므로 프리셋과 동률 취급
}
```

## 예시 입출력

```js
buildCachedFoodCandidates([
  // 1) 그릇 단위 조리음식 — 총중량 230g으로 정상 판정
  {
    foodKey: 'mfds_D101-aaa',
    name: '김치찌개',
    per100g: { kcal: 46, carbG: 3, proteinG: 4, fatG: 2 },
    basis: 'g',
    foodGroup: 'dish',
    totalAmount: 230,
    totalUnit: 'g',
    servingAmount: null,
    servingUnit: null,
  },
  // 2) 라멘류 — 총중량이 정확히 100 → resolveServing이 null → 버려진다
  {
    foodKey: 'mfds_D101-bbb',
    name: '라멘_미소라멘',
    per100g: { kcal: 89, carbG: 11.4, proteinG: 4.6, fatG: 2.8 },
    basis: 'g',
    foodGroup: 'dish',
    totalAmount: 100,
    totalUnit: 'g',
    servingAmount: null,
    servingUnit: null,
  },
  // 3) 가공식품 — 1회 제공량 30g으로 판정
  {
    foodKey: 'mfds_P200-ccc',
    name: '그릭요거트',
    per100g: { kcal: 60, carbG: 4, proteinG: 10, fatG: 0.4 },
    basis: 'g',
    foodGroup: 'processed',
    totalAmount: 500,
    totalUnit: 'g',
    servingAmount: 30,
    servingUnit: 'g',
  },
  // 4) 영양소 한 칸이 비어있음 — 환산해도 fatG가 null → 버려진다
  {
    foodKey: 'mfds_P200-ddd',
    name: '불명확 가공식품',
    per100g: { kcal: 120, carbG: 20, proteinG: 3, fatG: null },
    basis: 'g',
    foodGroup: 'processed',
    totalAmount: null,
    totalUnit: null,
    servingAmount: 50,
    servingUnit: 'g',
  },
])
```

기대 출력 (2번·4번은 빠지고 2건만 남는다):

```js
[
  {
    id: 'cache_mfds_D101-aaa',
    label: '김치찌개',
    entries: [{ name: '김치찌개', foodKey: 'mfds_D101-aaa', kcal: 105.8, carbG: 6.9, proteinG: 9.2, fatG: 4.6 }],
    macros: { kcal: 105.8, carbG: 6.9, proteinG: 9.2, fatG: 4.6 },
    recencyPenalty: 0,
  },
  {
    id: 'cache_mfds_P200-ccc',
    label: '그릭요거트',
    entries: [{ name: '그릭요거트', foodKey: 'mfds_P200-ccc', kcal: 18, carbG: 1.2, proteinG: 3, fatG: 0.1 }],
    macros: { kcal: 18, carbG: 1.2, proteinG: 3, fatG: 0.1 },
    recencyPenalty: 0,
  },
]
```

(46×230/100=105.8, 3×230/100=6.9, 4×230/100=9.2, 2×230/100=4.6 / 60×30/100=18, 4×30/100=1.2, 10×30/100=3, 0.4×30/100=0.12→반올림 0.1 — `scaleNutrients`가 소수 첫째자리로 반올림한다는 걸 기존 코드에서 그대로 가져온 값이다. 실제 숫자는 반드시 `scaleNutrients`를 직접 돌려서 확인하고 테스트에 넣는다 — 이 문서의 숫자를 못 믿고 다시 계산할 것.)

## 경계 케이스

- `cachedFoods`가 빈 배열 → 빈 배열 반환
- `cachedFoods`가 배열이 아님 → `TypeError` (`buildCandidatePool`과 같은 에러 메시지 스타일: `buildCachedFoodCandidates: cachedFoods must be an array, got ...`)
- **중복 제거는 이 함수 책임이 아니다.** 같은 음식이 프리셋에도 있고 캐시에도 있으면 후보가 두 번 들어갈 수 있다 — 그래도 된다. 합치는 쪽(`app.js`, Codex 범위 밖)이 필요하면 나중에 처리한다.
- `resolveServing`과 `scaleNutrients`는 이미 있는 함수를 **그대로 import해서 쓴다.** 새로 구현하지 않는다.

## 테스트

`tests/roulette.test.js`에 추가한다. 최소 이 케이스를 전부 덮는다:

- 정상 항목 1개 → 올바르게 환산된 candidate 1개
- `resolveServing`이 null인 항목(총중량 정확히 100, 1회분 정보 없음) → 결과에서 빠짐
- 환산 후 영양소 하나가 null인 항목 → 결과에서 빠짐
- 빈 배열 입력 → 빈 배열 출력
- 배열이 아닌 입력 → TypeError
- 여러 항목이 섞였을 때 통과하는 것만 순서대로 남는지

## 수용 기준

```bash
npm test
```

전부 통과. `buildCandidatePool` 기존 테스트는 한 글자도 안 바뀌어야 한다 —
바뀌었다면 건드리면 안 되는 걸 건드린 것이다.
