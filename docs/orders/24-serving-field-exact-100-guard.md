# 발주 24 — `NUTRI_AMOUNT_SERVING`에도 「정확히 100」 함정 가드를 건다

## 왜

발주 22가 `Z10500`(총중량)이 정확히 100인 조리음식을 걸렀다 — 라멘 한 그릇이
89kcal로 기록되던 그 버그다. 그런데 `resolveServing`(`src/lib/mfdsParser.js`)을 보면
**같은 함정이 `servingAmount`(`NUTRI_AMOUNT_SERVING`) 쪽에는 안 걸려 있다:**

```js
export function resolveServing(parsed) {
  if (
    parsed.foodGroup === 'dish'
    && parsed.totalAmount != null
    && parsed.totalAmount !== 100        // ← totalAmount는 100을 거른다
    && (parsed.totalUnit == null || parsed.totalUnit === parsed.basis)
  ) {
    return { amount: parsed.totalAmount, unit: parsed.basis, source: 'dish-total' };
  }

  if (
    parsed.servingAmount != null          // ← servingAmount는 100이어도 그냥 통과한다
    && (parsed.servingUnit == null || parsed.servingUnit === parsed.basis)
  ) {
    return { amount: parsed.servingAmount, unit: parsed.basis, source: 'serving-field' };
  }

  return null;
}
```

실제 API 표본(2026-08-14, `라면`/`라멘`/`국밥`/`찌개`/`김밥`/`비빔밥`/`덮밥`/`우동`/
`파스타`/`볶음밥` 10종 질의, 조리음식 388건)에서는 이 경로로 100이 나온 사례가
0건이었다 — **지금 당장 터지는 버그는 아니다.** 그래도 코드에 있는 한 같은 클래스의
함정이 언젠가 걸릴 수 있다. 발주 22와 같은 원칙을 `servingAmount`에도 그대로 적용해서
막아둔다 — 재발 방지 성격의 하드닝이다.

## 고칠 것

`src/lib/mfdsParser.js`의 `resolveServing`만 고친다. 두 번째 조건(`servingAmount`
분기)에 **딱 한 줄** 추가한다: `foodGroup === 'dish'`이고 `servingAmount === 100`이면
그 분기도 통과시키지 않는다.

**가공식품(`processed`)·재료(`ingredient`)는 건드리지 않는다.** 발주 22가 `dish`
전용으로 가드를 걸었던 것과 똑같은 이유다 — 가공식품은 1회 제공량이 진짜로 100인
경우가 흔하다(예: 요거트 100g 컵). "조리음식인데 1인분이 하필 100"인 경우만 의심한다.

의사코드:

```js
if (
  parsed.servingAmount != null
  && parsed.servingAmount !== (parsed.foodGroup === 'dish' ? 100 : parsed.servingAmount)
  // 위는 예시일 뿐이다 — 실제로는 아래처럼 읽기 쉽게 쓴다:
) { ... }
```

명확하게 쓰면:

```js
const servingLooksLikeBasisLeak = parsed.foodGroup === 'dish' && parsed.servingAmount === 100;

if (
  parsed.servingAmount != null
  && !servingLooksLikeBasisLeak
  && (parsed.servingUnit == null || parsed.servingUnit === parsed.basis)
) {
  return { amount: parsed.servingAmount, unit: parsed.basis, source: 'serving-field' };
}
```

**의심된 항목은 `null`을 반환한다** (첫 번째 분기도 이미 실패한 상태이므로 자동으로
함수 끝의 `return null`로 떨어진다 — 따로 처리 안 해도 된다). UI가 "1인분 정보 없음,
직접 입력하세요"로 받는다(이미 그렇게 동작함, 이번 발주 범위 아님).

## 경계 케이스 — 반드시 테스트로 잠근다

| foodGroup | totalAmount | servingAmount | 기대 결과 |
|---|---|---|---|
| `dish` | `null` | `100` | **`null`** (새 가드에 걸림) |
| `dish` | `100` | `null` | 이미 `null` (발주 22가 잠갔음, 회귀 확인용) |
| `dish` | `null` | `99` | `{ amount: 99, unit: ..., source: 'serving-field' }` (정상 — 100 아니면 안 건드림) |
| `dish` | `null` | `101` | `{ amount: 101, ... }` (정상) |
| `processed` | `null` | `100` | `{ amount: 100, ..., source: 'serving-field' }` (그대로 통과 — **가공식품은 가드 대상 아님**) |
| `ingredient` | `null` | `100` | `{ amount: 100, ... }` (그대로 통과) |
| `dish` | `500` | `100` | `{ amount: 500, unit: ..., source: 'dish-total' }` (첫 분기에서 이미 잡혀서 두 번째 분기까지 안 감 — `totalAmount`가 100이 아니므로 정상 동작, 회귀 확인용) |

마지막 두 줄은 **기존 테스트에 이미 있을 가능성이 높다** — 있으면 지우지 말고 그대로
둔 채, 위 표에서 아직 없는 케이스만 추가한다.

## 수용 기준

```bash
npm test
node scripts/verify-mfds.mjs
```

`verify-mfds.mjs`가 실행 환경 네트워크 차단으로 `fetch failed`가 나면(과거에도 자주
그랬다) 그건 실패로 치지 않는다 — `npm test` 통과 여부로만 판단한다. 단, 네트워크가
되면 반드시 같이 돌려서 1회분 판정 분포가 이상하게 안 바뀌었는지 확인한다.
