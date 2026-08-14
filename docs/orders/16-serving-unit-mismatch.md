# 발주 16 — 기준 단위와 1회분 단위가 다르면 1회분을 쓰지 않는다

## 왜 — 지금 5배 틀린 값이 조용히 기록된다

`resolveServing()` 이 `basis`(영양값 기준 단위)와 1회분의 단위가 **다른데도** 그대로 돌려준다.
화면은 그 수치로 `per100g` 를 곱한다.

```
삼대오백 WPI 웨이프로틴 초코
  SERVING_SIZE = 100g      → basis = 'g',  per100g.kcal = 395
  NUTRI_AMOUNT_SERVING = '150ml'  → servingAmount 150, servingUnit 'mL'

  지금:  395 × (150/100) = 592 kcal 로 기록된다
  실제:  150mL 는 물에 타서 만든 음료의 부피다. 가루 1스쿱(약 30g)은 그 1/5 수준이다
```

**가루의 밀도를 모르므로 mL → g 환산이 불가능하다.** 모르는 걸 곱하면 안 된다.
이건 「없는 값을 0으로 채우는 것」과 같은 종류의 잘못이고, 더 나쁘다 —
**0 은 눈에 띄지만 592 는 그럴듯해 보인다.**

## 분포 (선행 조사, N=334 · 질의 10종)

질의: `FOOD_NM_KR` = 웨이프로틴 / 프로틴 / 보충제 / 분말 / 파우더 / 시리얼 / 커피 / 요거트 / 두유 / 스무디.
**1회분 필드가 있는 항목만** 센 것이다. **이 조합 밖은 미검증이다.**

| basis ↔ 1회분 단위 | 건수 | 비율 |
|---|---|---|
| 일치 | 314 | 94% |
| **불일치 (g 기준 ↔ mL 1회분)** | **18** | **5%** |
| **불일치 (mL 기준 ↔ g 1회분)** | **2** | **0.6%** |

관측된 불일치 예 (전부 실제 값):
```
삼대오백 WPC 웨이프로틴 쿠앤크        | 100g | 1회=150ml
삼대오백 WPI 웨이프로틴 바나나        | 100g | 1회=150ml
삼대오백 WPI 웨이프로틴 초코          | 100g | 1회=150ml
삼대오백 WPI 웨이프로틴 피스타치오초코  | 100g | 1회=150ml
```

## 만들 / 고칠 파일

- `src/lib/mfdsParser.js` (수정 — `resolveServing` 만)
- `tests/mfdsParser.test.js` (보강)

**다른 export 는 건드리지 않는다.** `parseMfdsFoodItem` 의 반환 필드도 그대로 둔다 —
`servingAmount`/`servingUnit` 는 원자료이므로 계속 실어 보낸다. 판정만 바뀐다.

---

## 고칠 것 — `resolveServing()` 에 단위 일치 조건을 넣는다

현재 판정 순서(발주 12)는 이렇다:

| 순서 | 조건 | `source` |
|---|---|---|
| 1 | `foodGroup === 'dish'` 이고 `totalAmount` 있음 | `'dish-total'` |
| 2 | `servingAmount` 있음 | `'serving-field'` |
| 3 | 그 외 | `null` |

**각 분기에 「단위가 basis 와 같아야 한다」를 추가한다.**

### 새 판정

| 순서 | 조건 | 반환 |
|---|---|---|
| 1 | `foodGroup === 'dish'` · `totalAmount` 있음 · **`totalUnit` 이 `null` 이거나 `basis` 와 같음** | `{ amount: totalAmount, unit: basis, source: 'dish-total' }` |
| 2 | `servingAmount` 있음 · **`servingUnit` 이 `null` 이거나 `basis` 와 같음** | `{ amount: servingAmount, unit: basis, source: 'serving-field' }` |
| 3 | 그 외 전부 | **`null`** |

두 가지가 바뀐다:

1. **단위가 다르면 그 분기를 건너뛴다.** 1번이 단위 불일치로 막히면 2번을 시도하고,
   2번도 막히면 `null` 이다
2. **`unit` 은 언제나 `basis` 를 돌려준다.** 예전엔 `totalUnit ?? basis` 였는데,
   이제 단위가 같을 때만 통과하므로 둘이 같다. `basis` 로 통일해서 「곱해도 되는 단위」임을 분명히 한다

**`unit` 이 `null` 인 경우를 통과시키는 이유:** 단위 표기가 없는 값(`'100'`)은
그 식품의 기준 단위로 읽는 게 자연스럽다. 실제로 `Z10500` 에 단위 없는 값이 관측됐다(발주 10).

### 예시로 잠글 것

| 항목 | basis | total | serving | 반환 |
|---|---|---|---|---|
| 삼대오백 WPI 웨이프로틴 초코 | `'g'` | 1000 `'g'`, `processed` | 150 `'mL'` | **`null`** ← 이 발주의 핵심 |
| 버거_빅맥 버거 | `'g'` | 223 `'g'`, `dish` | 없음 | `{223, 'g', 'dish-total'}` |
| 김밥 | `'g'` | 230 `'g'`, `dish` | 없음 | `{230, 'g', 'dish-total'}` |
| 단백질 쉐이크 흑임자 | `'g'` | 500 `'g'`, `processed` | 40 `'g'` | `{40, 'g', 'serving-field'}` |
| `dish` 인데 `totalUnit` 이 basis 와 다르고, `servingAmount` 는 basis 와 같음 | `'g'` | 650 `'mL'`, `dish` | 30 `'g'` | `{30, 'g', 'serving-field'}` ← 1번이 막히고 2번이 성립 |
| `dish`, `totalAmount` 있고 `totalUnit` `null` | `'mL'` | 500 `null` | 없음 | `{500, 'mL', 'dish-total'}` |

## 테스트 요구사항

- **위 모든 표의 모든 행**을 테스트한다
- **단위 불일치로 `null` 이 되는 케이스를 반드시 잠근다** — 이 발주의 존재 이유다.
  `g` 기준 ↔ `mL` 1회분, `mL` 기준 ↔ `g` 1회분 **양방향 모두**
- **1번이 막히고 2번이 성립하는 폴백**을 잠근다 (표의 다섯째 행)
- `unit` 이 언제나 `basis` 와 같은지 확인한다
- 발주 12 가 만든 기존 테스트 중 **단위가 어긋나는데 통과한다고 단언하는 것이 있으면 고친다.**
  그 외 기존 테스트는 그대로 통과해야 한다
- 테스트는 표에서 유도한다. 구현을 읽고 베끼지 않는다

## 수용 기준

```bash
npm test                        # 기준선 203개
node scripts/verify-mfds.mjs    # 파싱 실패 0건
node scripts/check-shared-sync.mjs   # 복사본 동기 (원본만 고치면 여기서 걸린다 — --fix 로 맞춘다)
```

`verify-mfds.mjs` 의 **「1회분 판정 분포」를 완료 보고에 붙인다.**
`(판정불가 — g 직접입력)` 이 **조금 늘어나는 게 정상이다** — 틀린 값을 내던 항목이
정직하게 「모름」으로 바뀌기 때문이다. 직전 값은 725건 중 46건이었다.

## 하지 말 것

- 의존성 추가 금지 · 네트워크 호출 금지
- `parseMfdsFoodItem` 의 반환 필드를 지우거나 이름을 바꾸지 말 것
- mL ↔ g 환산 계수를 **지어내지 말 것.** 밀도는 식품마다 다르다. 모르면 `null` 이다
- `functions/`, `public/` 을 건드리지 말 것 (동기화는 Claude 가 한다)
- 표에 없는 규칙을 지어내지 말 것 — 비었으면 채우지 말고 보고한다
- **커밋하지 말 것**
