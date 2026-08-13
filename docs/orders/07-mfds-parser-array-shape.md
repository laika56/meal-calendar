# 발주 07 — 식약처 파서: `items`가 배열 자체로 오는 케이스 (Codex)

담당: **Codex** · 대상: `src/lib/mfdsParser.js` (기존 파일 수정), `tests/mfdsParser.test.js` · 선행: 없음

공통 계약은 `../../AGENTS.md`. **여기 안 적힌 동작을 지어내지 않는다.**

## 배경

발주04에서 확정한 `parseMfdsSearchResponse`는 `response.body.items.item`을 읽는다 —
`items`가 항상 `{ item: [...] }` 형태로 온다고 가정했다 (그때 실측 샘플이 그랬다).

**오늘 실제 검색 엔드포인트(Cloud Functions)를 붙이면서 다른 실측이 나왔다.**
`numOfRows=20&FOOD_NM_KR=닭가슴살`로 조회하면 `body.items`가 **배열 자체**로 온다 —
`{ item: [...] }` 래퍼가 없다. 기존 코드가 `response.body.items.item`을 읽으면 `undefined`가
나오고, `Array.isArray(undefined)`가 `false`라 `[undefined]`가 되어 다음 단계에서
`raw.FOOD_CD` 접근 시 죽는다. **실제로 배포된 Cloud Function에서 이 에러로 500이 났다.**

새 실측 샘플: `tests/fixtures/mfds-search-array-shape.json` (4건, `numOfRows=20` 검색 응답의
`items`가 배열 자체인 실제 사례).

기존 실측(발주04, `tests/fixtures/mfds-sample.json`)은 `numOfRows=1`일 때 `items: {item: {...}}`
(단수 객체), `numOfRows=10`일 때는 확인 안 됨 — 그때 검증 안 한 부분이다. **정확한 규칙(언제
배열이고 언제 래퍼인지)은 API가 안 밝혔고 우리도 모른다.** 그래서 값 자체로 판별한다: 형태를
보고 대응한다.

## 고칠 것

`src/lib/mfdsParser.js`의 `parseMfdsSearchResponse` 하나만 고친다. `parseMfdsFoodItem`은
안 건드린다.

**`body.items` 판별 순서:**

1. `body.items`가 **배열이면** 그 배열을 그대로 쓴다.
2. `body.items`가 배열이 아니고 **객체면**, `body.items.item`을 꺼낸다.
   그게 배열이면 그대로, 배열이 아니면(단수 객체) `[body.items.item]`로 감싼다.
   (이건 발주04의 기존 로직 그대로 — 유지한다.)
3. 그 외(`null`, 문자열, 숫자 등)면 `TypeError`를 던진다:
   `` `parseMfdsSearchResponse: unexpected items shape, got ${JSON.stringify(response.body.items)}` ``

**나머지는 발주04 그대로 유지한다:**
- `response.header.resultCode !== '00'` → 에러 (기존 그대로)
- `totalCount === 0` 이거나 `items`가 없으면 → 빈 배열 (기존 그대로)
- 각 원소는 기존과 동일하게 `parseMfdsFoodItem`에 넘긴다

## 테스트 추가

`tests/mfdsParser.test.js`에 추가한다 (기존 테스트 건드리지 않는다):

1. `tests/fixtures/mfds-search-array-shape.json`을 읽어서 `parseMfdsSearchResponse`에 통째로
   넘기고, 4건이 전부 정상 파싱되는지 (`foodCode`가 4개 다 다른지 정도로 확인)
2. `body.items`가 배열인 합성 입력 — 1개짜리 배열도 확인 (배열이면 원소 1개여도 그대로 배열로
   처리되는지, 기존 "단수 객체" 케이스와 헷갈리지 않는지)
3. `body.items`가 `null`인 합성 입력 → 기존 규칙대로 빈 배열 (에러 아님 — `!response.body.items`
   조건에 이미 걸린다는 걸 확인)
4. `body.items`가 숫자·문자열인 합성 입력 → 새 `TypeError`, 메시지 확인
5. 기존 발주04 테스트(단수 `{item: {...}}`, 복수 `{item: [...]}`)가 **여전히 통과하는지**

## 완료 조건

- `npm test` 전체 통과 (기존 + 신규)

## 완료 보고

`../../AGENTS.md`의 「완료 보고 형식」대로. `npm test` **실제 출력**을 붙인다.

## 판단이 필요하면

멈추고 묻는다.
