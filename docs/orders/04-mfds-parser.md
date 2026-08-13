# 발주 04 — 식약처 응답 파서 (Codex)

담당: **Codex** · 대상: `src/lib/mfdsParser.js` (신규) · 선행: 없음

공통 계약은 `../../AGENTS.md`. **여기 안 적힌 동작을 지어내지 않는다.** 빠진 게 있으면 채우지 말고 알린다.

## 배경

공공데이터포털 식약처 식품영양성분DB API 키를 오늘 발급받았다 (개발계정, 자동승인).
`getFoodNtrCpntDbInq02` 엔드포인트를 실제로 호출해 응답을 확보했고, 필드 의미는 포털이 제공하는
공식 참고문서(`출력메세지_식품영양성분DB정보.xlsx`)로 대조했다. **추측 없이 실측 + 공식 문서 둘 다 있다.**

- Base URL: `https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02`
- 실제 응답 샘플 6건: `tests/fixtures/mfds-sample.json` (전부 실제 API 호출 결과, 2026-08-13 조회)

## 확인된 사실

**요청 파라미터** (Swagger 명세에서 확인):

| 이름 | 설명 |
|---|---|
| `serviceKey` | 인증키 (필수) |
| `pageNo`, `numOfRows` | 페이징 |
| `type` | `xml`(기본) / `json` |
| `FOOD_NM_KR` | 식품명 검색 |
| `FOOD_CAT1_NM` | 식품대분류명 |
| (그 외 `RESEARCH_YMD`, `MAKER_NM`, `ITEM_REPORT_NO`, `UPDATE_DATE`, `DB_CLASS_NM`도 있으나 이번 발주 대상 아님) |

**응답 필드 → 의미** (전부 문자열 타입으로 온다. 공식 참고문서 대조 완료):

| 필드 | 의미 |
|---|---|
| `FOOD_CD` | 식품코드 |
| `FOOD_NM_KR` | 식품명 |
| `FOOD_CAT1_NM` | 식품대분류명 |
| `SERVING_SIZE` | 영양성분함량기준량 — **실측 6건 전부 `"100g"`.** 다른 값이 나올 수 있는지는 확인 안 됨 |
| `AMT_NUM1` | 에너지(kcal) |
| `AMT_NUM2` | 수분(g) — 이 발주 대상 아님 |
| `AMT_NUM3` | 단백질(g) |
| `AMT_NUM4` | 지방(g) |
| `AMT_NUM5` | 회분(g) — 이 발주 대상 아님 |
| `AMT_NUM6` | 탄수화물(g) |
| `AMT_NUM7` | 당류(g) — 이 발주 대상 아님 |
| `AMT_NUM8` | 식이섬유(g) — 이 발주 대상 아님 |

값은 `"137.000"`처럼 소수 문자열로 온다. 실측 100건 중 핵심 4필드(`AMT_NUM1`,`3`,`4`,`6`)가 빈 문자열인
경우는 못 봤지만, 다른 `AMT_NUM` 필드(예: `AMT_NUM15`)는 실측에서 빈 문자열 `""`이 나온 걸 확인했다
(`tests/fixtures/`에는 포함 안 함, 핵심 4필드만 담았다). **빈 문자열이 나올 가능성을 코드로 방어한다.**

## 만들 것

`src/lib/mfdsParser.js` — 순수 함수. `import`는 `node:` 내장만 허용. DOM·네트워크·Firebase 금지.
(이 API를 실제로 호출하는 코드는 이 발주 대상이 아니다 — Cloud Functions 쪽이고 API 키를 만지므로
`AGENTS.md`에 따라 Claude 담당이다. 여기서는 **이미 받은 JSON을 앱 내부 형태로 변환하는 파서만** 만든다.)

### `parseMfdsFoodItem(item)`

**입력**: 식약처 API 응답의 `body.items.item` 배열 원소 하나 — `tests/fixtures/mfds-sample.json`의
`items[]` 원소 형태 그대로 (필드가 전부 문자열).

**출력**:

```js
{
  foodCode: string,       // item.FOOD_CD 그대로
  name: string,           // item.FOOD_NM_KR 그대로
  category: string,       // item.FOOD_CAT1_NM 그대로
  per100g: {
    kcal: number | null,
    proteinG: number | null,
    fatG: number | null,
    carbG: number | null,
  },
}
```

**동작:**

1. `item.SERVING_SIZE`가 정확히 `"100g"`이 아니면 **파싱하지 않고 던진다**:
   `throw new Error(\`parseMfdsFoodItem: expected SERVING_SIZE "100g", got ${JSON.stringify(item.SERVING_SIZE)} for ${item.FOOD_CD}\`)`
   → `per100g`를 가정하고 있는데 실제 기준량이 다르면 숫자가 전부 틀어진다. 절대규칙 7 —
   억지로 100g라 치지 않는다.
2. `AMT_NUM1`(kcal), `AMT_NUM3`(protein), `AMT_NUM4`(fat), `AMT_NUM6`(carb) 각각을 숫자로 변환:
   - 빈 문자열(`""`) → `null`
   - 그 외 → `Number(value)`. 변환 결과가 `NaN`이면 **던진다**:
     `throw new Error(\`parseMfdsFoodItem: ${필드명} is not a valid number, got ${JSON.stringify(value)} for ${item.FOOD_CD}\`)`
     (필드명 자리에는 `AMT_NUM1` 같은 원본 키가 아니라 `kcal`/`proteinG`/`fatG`/`carbG` — 사람이 읽을 이름을 쓴다)
   - 음수가 나오면 (영양성분은 음수일 수 없다) **던진다**: 같은 형식, `"must not be negative"`
3. `foodCode`/`name`/`category`는 검증 없이 그대로 옮긴다 (빈 문자열이어도 통과 — 이 발주 대상 아님)

### `parseMfdsSearchResponse(response)`

**입력**: API 응답 전체 — `{ header: { resultCode, resultMsg }, body: { items: { item: [...] | {...} }, totalCount, ... } }`.

**주의 (실측에서 확인된 함정):** `numOfRows=1`일 때 `item`이 **배열이 아니라 객체 하나**로 온다
(공공데이터포털 XML→JSON 변환의 흔한 특성). `numOfRows`가 2 이상이면 배열로 온다.
**둘 다 처리한다** — `Array.isArray(item) ? item : [item]`.

**동작:**

1. `response.header.resultCode !== '00'`이면 던진다:
   `throw new Error(\`parseMfdsSearchResponse: API error ${response.header.resultCode} ${response.header.resultMsg}\`)`
2. `response.body.totalCount === 0`이거나 `items`가 없으면 **빈 배열을 반환한다** (에러 아님 — 검색결과 없음은 정상 케이스)
3. 각 item을 `parseMfdsFoodItem`에 넘겨 배열로 반환. 개별 item에서 던진 에러는 잡지 않고 그대로 올린다

## 테스트

`tests/mfdsParser.test.js`. `node:test` + `node:assert/strict`.

**픽스처는 `tests/fixtures/mfds-sample.json`을 읽어 쓴다.** 숫자를 새로 만들지 않는다 —
절대규칙 2: 이 파일의 값은 전부 실제 API 응답이라 그대로 써도 된다.

**필수 케이스:**

1. `tests/fixtures/mfds-sample.json`의 6건 전부 `parseMfdsFoodItem`에 넣고, 결과의 `per100g.kcal`이
   원본 `AMT_NUM1`을 `Number()`로 변환한 값과 같은지 (6건 전부 반복문으로)
2. `SERVING_SIZE`가 `"100g"`이 아닌 합성 입력(예: `"1인분(250g)"`) → 던지는지, 메시지에 원본 값이 포함되는지
3. `AMT_NUM1`이 빈 문자열인 합성 입력 → `kcal: null` (던지지 않음)
4. `AMT_NUM3`이 `"abc"` 같은 숫자 아닌 문자열인 합성 입력 → 던지는지 (메시지에 `proteinG` 포함)
5. `AMT_NUM4`가 `"-1.5"`인 합성 입력 → 던지는지 (음수 거부)
6. `parseMfdsSearchResponse` — `numOfRows=1` 형태(item이 객체) / `numOfRows>1` 형태(item이 배열)
   **둘 다** 합성 입력으로 만들어서 둘 다 배열로 정규화되는지
7. `parseMfdsSearchResponse` — `resultCode !== '00'`인 합성 입력 → 던지는지
8. `parseMfdsSearchResponse` — `totalCount: 0`인 합성 입력 → 빈 배열 반환 (던지지 않음)

**금지:**
- 픽스처 파일 밖에서 실제 식품의 영양 수치를 손으로 쓰지 않는다. 2~8번처럼 파싱 로직만 테스트할
  땐 임의의 합성값(`"abc"`, `"-1.5"` 등)을 쓴다 — 실제 식품 수치인 것처럼 보이는 값을 지어내지 않는다

## 완료 조건

- `npm test` 전체 통과 (기존 28개 + 신규)

## 완료 보고

`../../AGENTS.md`의 「완료 보고 형식」대로. `npm test` **실제 출력**을 붙인다.

## 판단이 필요하면

멈추고 묻는다. 특히:
- `SERVING_SIZE`가 `"100g"` 아닌 실제 사례를 만났을 때 (이 발주는 100g 고정을 가정한다 — 다른
  기준량 처리는 범위 밖이다)
- 이 문서에 없는 필드를 파싱해야 하는 상황
