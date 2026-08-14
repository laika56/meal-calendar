# 발주 26 — 1인분을 모를 때 같은 카테고리의 대표 중량을 참고값으로 준다

## 왜

지금 1인분을 모르는 음식은 화면이 이렇게 말한다:

> 1인분 정보 없음 — 실제 무게(g)를 확인해서 입력하세요.

**거짓말은 안 하지만 아무 도움도 안 된다.** 사용자는 자기가 먹은 라멘이 몇 g 인지
모른다. 같은 불만이 세 번 나왔다 (2026-08-14):

> "라멘 이런거 100g으로 하는데 내가 이 음식이 100g인지 어떻게 아냐"

숫자를 지어내면 절대규칙 2 위반이다. 그래서 **같은 카테고리에서 이미 아는 값들**로
답한다 — 표는 실제 식약처 응답에서 뽑아 `src/data/servingByCategory.json` 에 있다.

실측 근거 — `scripts/build-serving-table.mjs` 실행 결과 (2026-08-14, 질의 30종 × 2페이지):
**고유식품 5,573건 · 조리음식 2,613건 · 그중 1인분을 아는 것 2,177건(83%) · 카테고리 15개.**
모르는 나머지도 같은 카테고리에 형제가 충분하다.

| 카테고리 | 단위 | n | 중앙값 | p25~p75 |
|---|---|---|---|---|
| **면 및 만두류** | **g** | **75** | **700** | 480.5~852.5 | ← 라멘이 여기다
| 찌개 및 전골류 | mL | 204 | 270 | 221.5~416.4 |
| 밥류 | mL | 177 | 400 | 300~572 |
| 밥류 | g | 87 | 330 | 250~410 |
| 국 및 탕류 | mL | 99 | 300 | 235.3~320 |

`라멘_미소라멘`(89kcal/100g, 면 및 만두류, basis=g)에 **700g** 을 적용하면
**약 623kcal** 다. 지금 화면이 보여주던 89kcal 와는 7배 차이다.

> **카테고리마다 `g` 와 `mL` 통계가 따로 있다.** 이 DB 는 고체 음식에도
> `SERVING_SIZE='100mL'` 을 쓰는 레코드가 섞여 있다(발주10 에서 이미 다룬 사실).
> 그래서 **반드시 `parsed.basis` 와 같은 단위 쪽만 본다** — 아래 규칙 3.

## 만들 것

`src/lib/servingEstimate.js` **새 파일**. 함수 하나만 export 한다.

```js
export function estimateServingFromCategory(parsed, table) { ... }
```

**기존 파일을 건드리지 않는다.** `mfdsParser.js`·`roulette.js` 등은 이 발주 범위 밖이다.

### 입력

- `parsed` — `parseMfdsFoodItem()` 의 결과. 쓰는 필드는 `category`(문자열|null),
  `basis`(`'g'` | `'mL'`) 둘뿐이다
- `table` — `src/data/servingByCategory.json` 을 그대로 넣은 객체. 모양:

```json
{
  "provenance": { "generatedAt": "...", "dishCount": 2613, "knownServingCount": 2177, "...": "..." },
  "categories": {
    "면 및 만두류": {
      "g": { "median": 700, "sampleCount": 75, "min": 220, "max": 2292, "p25": 480.5, "p75": 852.5 }
    },
    "밥류": {
      "g": { "median": 330, "sampleCount": 87, "min": 94.5, "max": 1200, "p25": 250, "p75": 410 }
    }
  }
}
```

> 카테고리 아래에 `g` 와 `mL` 이 **둘 다 있을 수도, 하나만 있을 수도** 있다.
> 표본이 5건 미만인 조합은 표 생성 단계에서 이미 빠져 있다.

### 출력

찾으면:

```js
{
  amount: 700,              // median 그대로
  unit: 'g',                // parsed.basis 와 같다
  source: 'category-median',
  category: '면 및 만두류',
  sampleCount: 75,
  min: 220,
  max: 2292,
  p25: 480.5,
  p75: 852.5,
}
```

못 찾으면 **`null`**. (예외를 던지지 않는다 — 「모른다」는 정상 상태다)

### 규칙

1. `parsed.category` 가 `null`/빈 문자열이면 → `null`
2. `table.categories` 에 그 카테고리가 없으면 → `null`
3. 그 카테고리에 **`parsed.basis` 와 같은 단위** 항목이 없으면 → `null`.
   **단위가 다르면 절대 섞지 않는다** — 발주16 에서 이미 못박은 규칙이다
   (`100mL` 기준 음료에 g 중앙값을 쓰면 5배 오류가 난다)
4. 찾으면 그 통계를 위 모양 그대로 돌려준다. **값을 반올림하거나 가공하지 않는다** —
   표에 있는 숫자가 그대로 나가야 근거 추적이 된다

### 검증 (입력이 이상하면 던진다)

`mfdsParser.js` 의 기존 스타일을 그대로 따른다 (`formatValue` 헬퍼 포함):

- `parsed` 가 객체가 아니면 → `TypeError`
  (`estimateServingFromCategory: parsed must be an object, got ...`)
- `table` 이 객체가 아니거나 `table.categories` 가 객체가 아니면 → `TypeError`
  (`estimateServingFromCategory: table.categories must be an object, got ...`)
- `parsed.basis` 가 `'g'`/`'mL'` 이 아니면 → `TypeError`
  (`estimateServingFromCategory: parsed.basis must be "g" or "mL", got ...`)

> **`NaN` 을 에러 메시지에 넣을 때 `JSON.stringify` 를 쓰지 않는다.**
> `JSON.stringify(NaN)` 은 문자열 `"null"` 을 낸다 — 실제 `null` 이 아닌데 그렇게 보인다.
> 리터럴 `NaN` 을 쓴다. (`mfdsParser.js` 의 `formatValue` 가 이미 그렇게 한다)

## 예시 입출력

```js
const table = {
  categories: {
    '면 및 만두류': { g: { median: 700, sampleCount: 75, min: 220, max: 2292, p25: 480.5, p75: 852.5 } },
    '음료류': { mL: { median: 200, sampleCount: 40, min: 100, max: 500, p25: 150, p75: 250 } },
  },
};

// 1) 정상 — 카테고리·단위 둘 다 맞는다
estimateServingFromCategory({ category: '면 및 만두류', basis: 'g' }, table)
// → { amount: 700, unit: 'g', source: 'category-median', category: '면 및 만두류',
//     sampleCount: 75, min: 220, max: 2292, p25: 480.5, p75: 852.5 }

// 2) 단위 불일치 — 표엔 mL 만 있는데 이 식품은 g 기준
estimateServingFromCategory({ category: '음료류', basis: 'g' }, table)   // → null

// 3) 표에 없는 카테고리
estimateServingFromCategory({ category: '듣보류', basis: 'g' }, table)   // → null

// 4) 카테고리 자체가 없다
estimateServingFromCategory({ category: null, basis: 'g' }, table)      // → null
```

## 경계 케이스 — 테스트로 잠근다

- 카테고리·단위 모두 일치 → 표의 값이 **그대로** 나온다(가공 없음)
- 같은 카테고리에 `g`·`mL` 이 둘 다 있을 때 → `basis` 와 맞는 쪽만 고른다
- 단위 불일치 → `null`
- 없는 카테고리 → `null`
- `category` 가 `null` / `''` → `null`
- `categories` 가 빈 객체 `{}` → `null`
- `parsed` 가 `null`/배열/문자열 → `TypeError`
- `table` 이 `null` 이거나 `categories` 가 없음 → `TypeError`
- `basis` 가 `'kg'`/`null`/숫자 → `TypeError`
- **실제 표 파일로 한 번 돌린다** — `src/data/servingByCategory.json` 을 읽어
  `{ category: '면 및 만두류', basis: 'g' }` 가 `null` 이 아니고 `amount > 0` 인지 확인.
  (표 파일은 이미 저장소에 있다. 네트워크 필요 없음)

## 수용 기준

```bash
npm test
```

전부 통과. **`src/lib/` 의 기존 파일과 `functions/` 는 건드리지 않는다** —
건드렸으면 범위를 벗어난 것이다.

## 이 발주 밖 (Claude 가 한다)

- 화면 배선 — 참고값을 **추정으로 명확히 표시**하고, 근거(카테고리·표본 수·범위)를
  같이 보여준다. **자동으로 입력칸을 채우지 않는다** — 사용자가 눌러서 넣는다.
  조용히 채우면 「그럴듯해 보이는 틀린 숫자」를 또 만드는 것이다
- `servingByCategory.json` 갱신 — `scripts/build-serving-table.mjs` 재실행
