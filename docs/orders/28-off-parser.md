# 발주 28 — Open Food Facts 응답 파서 (Codex)

담당: **Codex** · 대상: `src/lib/offParser.js` (신규) · 선행: 없음

공통 계약은 `../../AGENTS.md`. **여기 안 적힌 동작을 지어내지 않는다.** 빠진 게 있으면 채우지 말고 알린다.

## 배경

Phase 8(바코드) 착수 조건이 풀렸다. `docs/DECISIONS.md`·`docs/ROADMAP.md`에 이미 정해진 대로
바코드 → 제품 조회는 **Open Food Facts**(무료·키 불필요)를 쓴다. 카메라·zxing-wasm 스캔 UI는
Claude/Opus 담당(이 발주 범위 밖) — 여기서는 **스캔해서 이미 받은 바코드로 OFF API를 호출한
결과를 앱 내부 형태로 변환하는 파서만** 만든다. `src/lib/mfdsParser.js`(발주04)와 같은 패턴이다.

**엔드포인트:** `https://world.openfoodfacts.org/api/v2/product/{barcode}.json` (인증 불필요, GET)

**실제 응답 샘플 8건**: `tests/fixtures/off-sample.json` — 전부 실제 API 호출 결과
(2026-08-18 조회, 한국 유통 제품 위주 검색으로 확보). 이 발주 대상 필드는 공식 문서가 아니라
**실측으로만** 확인했다 — OFF는 커뮤니티 편집 DB라 필드가 항상 다 채워진다는 보장이 없다.

## 확인된 사실 (실측 70건 기준 분포)

| 항목 | 분포 |
|---|---|
| `product.nutrition_data_per` | `"100g"` 63%, `"100ml"` 34%, **없음(undefined) 3%** |
| `product.serving_size` 존재 | 86% (나머지는 필드 자체가 없음) |
| `serving_size` 포맷 | **자유텍스트라 파싱 대상 아님** — `"1/ bottle 250 ml"`, `"1 package (140 g)"`, `"serving"`, `"1170.0g"` 등 뒤죽박죽. **이 발주는 `serving_size`를 파싱하지 않는다** (범위 밖 — 필요해지면 별도 발주) |
| 핵심 매크로(`energy-kcal`/`proteins`/`fat`/`carbohydrates`) 개별 결측 | 각 7~9% |
| `salt`/`sodium` 결측 | 39% — **이 발주 대상 아님** (앱이 현재 salt/sodium을 안 쓴다, MFDS 파서도 안 다룸) |
| `brands` 결측 | 11% |
| 바코드 자체가 DB에 없음(`status: 0`) | 실측 샘플엔 못 넣었지만 임의 바코드 3개 중 3개가 이 케이스였다 — 국내 제품 커버리지 구멍은 `docs/DECISIONS.md`에 이미 기록된 사실이다 |

값은 **전부 숫자 타입으로 온다** (MFDS와 다르게 문자열 아님) — `energy-kcal: 423`처럼.
접미사 없는 키(`proteins`)와 `_100g` 접미사 키(`proteins_100g`)가 실측 8건 전부 같은 값이었지만,
**항상 같은지는 검증 못 했다.** 이 발주는 접미사 없는 키만 신뢰한다 (아래 명시).

## 만들 것

`src/lib/offParser.js` — 순수 함수. `import`는 `node:` 내장만 허용. DOM·네트워크·Firebase 금지.
(실제로 이 API를 호출하는 코드는 이 발주 대상이 아니다.)

### `parseOffProduct(response)`

**입력**: OFF API v2 product 엔드포인트의 응답 객체 그대로 —
`tests/fixtures/off-sample.json`의 각 값 형태 (`{ code, status, status_verbose, product?: {...} }`).

**출력**: 아래 셋 중 하나.

```js
// 1) 바코드가 DB에 없음 — 에러 아님, 정상 케이스 (docs/DECISIONS.md: "실패 시 수동 입력 폴백")
null

// 2) 바코드는 있지만 영양정보 자체가 없음(nutrition_data_per 없음)
{
  code: string,
  name: string | null,   // product.product_name, 없으면 null
  brand: string | null,  // product.brands, 없으면 null
  unit: null,
  per100: null,
}

// 3) 영양정보 있음
{
  code: string,
  name: string | null,
  brand: string | null,
  unit: 'g' | 'ml',
  per100: {
    kcal: number | null,
    proteinG: number | null,
    fatG: number | null,
    carbG: number | null,
  },
}
```

**동작:**

1. `response.status !== 1` → **`null` 반환** (던지지 않는다 — 제품이 DB에 없는 건 정상 케이스다).
   `response.product`가 없는 경우도 (실측에선 못 봤지만) 같이 `null` 반환한다.
2. `product.nutrition_data_per`을 본다:
   - `"100g"` → `unit = 'g'`
   - `"100ml"` → `unit = 'ml'`
   - `undefined`/`null` → `unit: null, per100: null`로 반환 (2번 케이스. 던지지 않는다 — OFF가 영양정보 자체를 안 가진 제품은 흔하다, 위 분포표 3% 참고)
   - **그 외 값**(예: `"1 serving"`처럼 100g/100ml가 아닌 다른 문자열) → **던진다**:
     `throw new Error(\`parseOffProduct: unexpected nutrition_data_per ${JSON.stringify(value)} for ${code}\`)`
     실측에서 이 케이스를 못 봤다 — 만나면 명세 밖이니 지어내지 않는다.
3. `unit`이 `'g'`/`'ml'`로 정해졌으면 `product.nutriments`에서 **접미사 없는 키**를 읽는다:
   `energy-kcal` → `kcal`, `proteins` → `proteinG`, `fat` → `fatG`, `carbohydrates` → `carbG`.
   각각:
   - 키가 없음 → `null` (흔한 케이스다, 위 분포표 7~9% 참고 — 이건 던지지 않는다)
   - 값이 있는데 `typeof value !== 'number'`이거나 `Number.isFinite(value)`가 false →
     **던진다**: `throw new Error(\`parseOffProduct: ${사람이름} is not a valid number, got ${JSON.stringify(value)} for ${code}\`)`
     (사람이름 자리엔 `kcal`/`proteinG`/`fatG`/`carbG` — MFDS 파서와 동일한 컨벤션)
   - 음수 → **던진다**: 같은 형식, 메시지 끝에 `"must not be negative"`
4. `name` = `product.product_name` 그대로 (없으면 `null`), `brand` = `product.brands` 그대로 (없으면 `null`) — 검증 없이 옮긴다.
5. `salt`/`sodium`/`sugars`/`serving_size`는 **이 발주 대상 아니다.** 읽지도, 출력에 넣지도 않는다.

## 테스트

`tests/offParser.test.js`. `node:test` + `node:assert/strict`.

**픽스처는 `tests/fixtures/off-sample.json`을 읽어 쓴다.** 숫자를 새로 만들지 않는다 —
이 파일의 값은 전부 실제 API 응답이라 그대로 써도 된다 (절대규칙 2).

**필수 케이스 (전부 픽스처의 정확한 키 이름):**

1. `per_100g_complete` → `unit: 'g'`, `per100.kcal`/`proteinG`/`fatG`/`carbG` 전부 원본
   `nutriments.energy-kcal`/`proteins`/`fat`/`carbohydrates` 값과 동일한지
2. `per_100g_complete_2` → 위와 동일하게 반복 (다른 브랜드, 다른 값)
3. `per_100g_liquid_product` → **`nutrition_data_per`가 `"100g"`이면 `quantity`가 `"230 ml"`여도
   `unit: 'g'`여야 한다** — `quantity`/제품명을 보고 액체라서 `'ml'`로 추측하지 않는지 확인
4. `per_100ml` → `unit: 'ml'`
5. `no_nutrition_data` → `unit: null, per100: null` 반환 (던지지 않음), `name`/`brand`는 채워짐
6. `partial_missing_core_macros` → `unit: 'g'`(값이 있으므로), `per100`의 네 필드 전부 `null`
   (던지지 않음 — 필드 자체가 없는 것과 3번 케이스의 "필드는 있는데 이상한 값"은 다르다)
7. `not_found` → `null` 반환 (통째로)
8. 합성 입력: `nutrition_data_per: "1 serving"` (실제 없는 값) → 던지는지, 메시지에
   `"nutrition_data_per"`와 `"1 serving"` 둘 다 포함되는지
9. 합성 입력: `nutriments["energy-kcal"] = "abc"` → 던지는지, 메시지에 `"kcal"` 포함
10. 합성 입력: `nutriments.proteins = -3` → 던지는지, 메시지에 `"proteinG"`와 `"negative"` 포함
11. `serving_with_parens` → `unit: 'g'`, 매크로 4개 전부 정상 파싱 (일반 케이스 회귀 확인용)

**금지:**
- 픽스처 파일 밖에서 실제 식품의 영양 수치를 손으로 쓰지 않는다. 8~10번처럼 파싱 로직만
  테스트할 땐 합성값(`"abc"`, `-3` 등)을 쓴다.
- `serving_size`/`salt`/`sodium`/`sugars`를 파싱하거나 출력에 넣지 않는다 — 범위 밖이다.

## 완료 조건

- `npm test` 전체 통과 (기존 316개 + 신규)

## 완료 보고

`../../AGENTS.md`의 「완료 보고 형식」대로. `npm test` **실제 출력**을 붙인다.

## 판단이 필요하면

멈추고 묻는다. 특히:
- `nutrition_data_per`가 `"100g"`/`"100ml"`도 아니고 없지도 않은 실제 사례를 만났을 때
- `nutriments`의 접미사 없는 키와 `_100g` 접미사 키 값이 다른 실제 사례를 만났을 때
  (이 발주는 둘이 같다고 가정한다 — 다르면 명세 밖이다)
- 이 문서에 없는 필드(`salt`/`sodium`/`sugars`/`serving_size` 등)를 파싱해야 하는 상황
