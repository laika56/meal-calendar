# Shared Barcode Catalog Design

## Goal

국내 포장식품 바코드를 한 번 스캔했을 때 개인 학습 데이터에 의존하지 않고 제품명과
검증된 영양정보를 찾는다. 무료 공용 데이터셋을 주기적으로 수집해 하나의 공용 카탈로그로
게시하고, 카탈로그에 없는 제품만 Open Food Facts로 조회한다.

사용자가 찍은 제품을 개인 바코드 DB에 저장하거나 다음 조회를 위해 학습시키지 않는다.
어느 승인된 출처에도 없는 제품은 영양값을 만들지 않고 `확인 못 함`으로 남긴다.

## Approved Direction

검토한 선택지는 다음 세 가지다.

1. **매 스캔마다 여러 외부 API 호출** — 구현은 짧지만 공급자 지연·점검·일일 한도를 매번
   사용자에게 전가하고, 같은 실패를 반복한다.
2. **벌크 공용 카탈로그만 사용** — 빠르고 결정적이지만 갱신 사이에 새 제품을 놓친다.
3. **벌크 공용 카탈로그 + 공개 fallback** — 국내 벌크 데이터를 우선 조회하고, miss일 때만
   Open Food Facts를 조회한다.

3번을 사용한다. 국내 제품의 반복 조회는 Firestore 공용 카탈로그에서 끝내고, OFF fallback은
현재의 정직한 miss/부분정보 동작을 유지한다. UPCitemdb는 무료 약관·쿼터·캐시 허용 범위를
실측하기 전에는 운영 경로에 넣지 않는다.

## Scope

- 식품이력추적정보와 FoodQR의 전체 바코드 데이터 수집·분포 측정
- 승인된 C005/I2570 API의 실제 응답·전체 건수·필드 분포 측정
- 소스별 원시 행을 공통 바코드 레코드로 정규화하는 순수 모듈
- 결정적인 중복 제거, 출처 보존, 충돌 거부, 카탈로그 manifest 생성
- Firestore 공용 카탈로그 dry-run/import와 ready pointer
- 인증된 `/api/foods/barcode` 조회 함수
- 스캔 흐름을 공용 카탈로그 우선, OFF fallback 순서로 변경
- 부분 영양정보를 0으로 만들지 않고 기존 확인 화면으로 전달
- 테스트, 실제 데이터 검증, 보안 규칙, 배포 후 실물 검증

범위 밖:

- 개인 바코드 학습·사용자별 제품 캐시
- 출처에 없는 칼로리·탄수화물·단백질·지방·1회분 추정
- 유료 데이터 공급자 계약
- 사진 OCR이나 포장지 이미지 저장
- 검증 근거 없는 단일 제품 수동 삽입

## Source Policy

초기 소스 우선순위는 다음과 같다.

1. 식품안전나라/식약처의 바코드와 영양성분이 직접 연결된 승인 데이터
2. FoodQR의 바코드·영양성분
3. 식품이력추적 바코드와 통합식품영양성분의 검증 가능한 보고번호 조인
4. Open Food Facts
5. USDA Branded Foods는 GTIN과 영양정보가 모두 있는 행만 보완 후보로 사용

각 소스는 사용 범위·재배포 조건·갱신일·원본 URL을 `sources.json`에 기록한다. 재배포 또는
캐시 권리가 불명확하면 그 소스는 측정만 하고 게시하지 않는다. 인증키와 원시 응답은 Git,
Hosting, 브라우저, 로그에 넣지 않는다.

### Measurement gate

새 파서를 만들기 전에 각 소스 전체를 읽어 아래 분포를 기록한다.

- 전체 행, 성공/오류 행, 중복 바코드, 유효 체크디지트
- 8/12/13/14자리 개수와 선행 0 GTIN-14 개수
- 제품명·제조사·보고번호·1회분·기준단위 결측률
- kcal·탄수화물·단백질·지방 각각의 결측률과 단위 종류
- 바코드가 다른 영양 레코드에 연결되는 충돌 수
- 기존 식품이력추적/FoodQR/OFF와의 교집합·순증가

분포 밖 형태를 파서가 만나면 조용히 버리지 않고 전체 publication을 거부한다. 소스가 점검
시간이면 재시도 횟수를 숨기지 않고 해당 실행을 실패로 기록한다.

## Canonical Barcode Rules

카탈로그 키는 숫자 문자열이며 선행 0을 임의로 제거하지 않는다.

- GTIN-8: 체크디지트가 맞으면 8자리 그대로 유지
- UPC-A 12자리: 체크디지트를 검증하고 앞에 `0`을 붙인 EAN-13 키로 정규화
- EAN-13: 체크디지트가 맞으면 그대로 유지
- GTIN-14: 체크디지트를 검증한다. 첫 자리가 `0`인 값만 13자리 EAN 키로 축약한다.
  첫 자리가 0이 아닌 GTIN-14는 원문 14자리 키로 보존한다.
- 공백, 하이픈, 과학 표기, 숫자형 JSON으로 앞자리 0이 소실된 값은 자동 복구하지 않는다.
- 잘못된 체크디지트는 제외 건수와 소스 위치를 기록한다.

스캐너가 현재 읽는 EAN13/EAN8/UPCA/UPCE 경계는 유지한다. 카탈로그 수집기가 추가로 GTIN-14를
처리하는 것이며 카메라 형식을 근거 없이 확장하지 않는다.

## Canonical Record

공용 문서는 ready pointer가 가리키는
`barcodeCatalogRuns/{runId}/foods/{canonicalBarcode}`에 저장한다.

```js
{
  barcode: '8800000000000',
  name: '검증된 원문 제품명',
  maker: '검증된 원문 제조사' | null,
  category: '검증된 원문 분류' | null,
  serving: { amount: 80, unit: 'g', source: 'official-serving' } | null,
  per100g: {
    kcal: 123 | null,
    carbG: 12.3 | null,
    proteinG: 4.5 | null,
    fatG: 6.7 | null,
  },
  source: {
    type: 'mfds' | 'foodqr' | 'mfds-joined' | 'off' | 'usda',
    sourceId: '원본의 안정적인 식별자',
    url: '검증된 출처 URL',
    verifiedAt: 'YYYY-MM-DD',
  },
}
```

- 존재하지 않는 필드는 `0`이나 평균으로 채우지 않고 `null`로 둔다.
- `serving`은 원본이 명시한 1회분만 허용한다. 카테고리 대표중량은 바코드 카탈로그의
  `official-serving`으로 승격하지 않는다.
- `per100g` 변환은 원본 기준량과 단위가 명확하고 유한한 양수일 때만 한다.
- 한 레코드의 영양값을 서로 다른 공급자에서 필드별로 짜깁기하지 않는다.
- 동일 바코드의 후보가 여러 개면 완전한 단일 후보를 소스 우선순위로 선택한다. 같은 순위에서
  제품 정체성이나 영양값이 충돌하면 자동 선택하지 않고 해당 바코드의 모든 후보를 제외하며
  제외 행 수를 `ambiguous-barcode`로 기록한다.

## Build and Publication

빌더는 기본 dry-run이며 다음 산출물을 fresh 외부 staging에 만든다.

- `barcode-foods.ndjson`
- `barcode-catalog-manifest.json`
- `BARCODE_CATALOG_REVIEW.md`

manifest에는 소스 snapshot hash, 정규화 규칙 버전, raw/accepted/excluded/conflict counts,
canonical record hash를 기록한다. 모든 레코드를 validator가 다시 읽어 파일 집합·정렬·중복·
체크디지트·스키마·manifest hash를 검증하기 전에는 Firestore를 쓰지 않는다.

Importer는 최대 400 writes의 결정적 batch plan을 만들고 먼저 dry-run한다. 실제 apply는 새 run
namespace에 문서와 manifest를 전부 게시한 뒤 마지막 transaction에서 ready pointer를 바꾼다.
실패한 run은 ready가 되지 않으며 이전 ready 카탈로그를 건드리지 않는다. 클라이언트는 공용
카탈로그를 읽거나 쓸 권한이 없고 Cloud Functions Admin SDK만 접근한다.

## Lookup API

`GET /api/foods/barcode?code=<barcode>`를 `asia-northeast3`에 추가한다.

1. Firebase 인증을 기존 `searchFoods`와 같은 방식으로 검증한다.
2. 입력을 canonical barcode 규칙으로 검증한다. 잘못된 형식은 `400`이다.
3. ready pointer에 묶인 exact barcode 문서를 한 번 조회한다.
4. 존재하면 `{ item, source: 'shared-catalog' }`를 `200`으로 반환한다.
5. 존재하지 않으면 `{ item: null }`을 `200`으로 반환한다. API가 외부 영양값을 추정하지 않는다.
6. 카탈로그 장애는 `503`이며 miss로 가장하지 않는다.

응답은 공개 카탈로그의 검증 필드만 포함한다. 인증키, 원시 행, 내부 snapshot 경로는 반환하지
않는다. 스캔 요청과 사용자 식단을 공용 카탈로그에 쓰지 않는다.

## Client Flow

스캐너가 canonical code를 얻은 뒤 다음 순서로 처리한다.

1. 인증된 `/api/foods/barcode`를 조회한다.
2. 공용 결과가 있으면 기존 양 선택/부분 확인 흐름으로 넘긴다.
3. 공용 miss일 때만 기존 Open Food Facts v2 조회를 수행한다.
4. 두 소스 모두 miss면 현재 수동 입력 문구로 돌아간다.
5. 공급자 오류는 `제품 없음`과 구분한다. 공용 API가 503이어도 OFF fallback은 시도하되,
   OFF도 실패하면 네트워크 오류임을 알린다.

제품명과 kcal가 검증됐지만 일부 매크로가 `null`인 경우 제품 전체를 버리지 않는다. 기존 부분
확인 화면에서 누락 필드를 보여주고 사용자가 그 식단 항목을 완성할 수 있게 한다. 이 입력은
개인 바코드 카탈로그를 성장시키지 않는다. 빈 값은 0으로 저장하지 않는다.

## Target Barcode

`8801392194078`은 지금까지 확인한 식품이력추적, FoodQR, Open Food Facts, UPCitemdb, USDA
무료 조회에서 발견되지 않았다. C005/I2570 전체 측정에서 발견되면 동일한 일반 규칙으로
카탈로그에 들어간다. 거기에도 없으면 제품명·영양값을 만들지 않는다. 공식 제조사 페이지나
포장지의 공개 검증 자료가 별도로 확보되면 개인 저장이 아닌 reviewed public source로 추가하는
별도 명세를 만든다.

## Secrets and Logging

- 데이터포털/식품안전나라 키는 로컬 환경 또는 Firebase Secret Manager에서만 읽는다.
- 키가 포함될 수 있는 URL, request header, raw response를 stdout/stderr에 출력하지 않는다.
- 테스트는 가짜 키와 fixture만 사용한다.
- `.env*`, 임시 ADC, 원시 다운로드, Firestore export는 Git/Hosting 배포 대상에서 제외한다.
- 배포 전 staged diff와 Hosting file list에서 키 패턴을 검사한다.

## Testing and Verification

모든 production 변경은 RED를 먼저 확인한다.

- 소스별 parser: 실제 분포에서 나온 모든 형태, malformed/누락/단위/숫자 경계
- barcode canonicalizer: 8/12/13/14자리, 선행 0, 잘못된 체크디지트, 문자열 보존
- builder: 결정적 정렬·중복·충돌·출처·manifest hash·부분 영양정보
- importer: dry-run, ready pointer, batch 경계, N번째/final 실패 rollback
- security rules: 인증 사용자도 catalog 직접 read/write 거부
- function: auth-before-lookup, hit/miss/400/503, secret 비노출
- client: shared hit, shared miss→OFF hit, 양쪽 miss, shared error→OFF, 부분 영양정보
- 전체 `npm test`, syntax, JSON parse, `git diff --check`
- 실제 source dry-run counts/hash 2회 일치
- apply 전후 catalog validator
- 배포 후 인증된 known hit/miss와 `8801392194078` 정직한 결과 확인
- iPhone에서 EAN-8/EAN-13/UPC 실물과 부분정보 화면 확인

## Deployment Order

1. 소스 전체 측정과 license gate
2. 순수 parser/builder/validator TDD
3. 실제 dry-run과 독립 검토
4. Firestore importer/rules/function TDD와 emulator
5. 단 한 번의 승인된 catalog apply
6. rules + barcode function + Hosting 순서로 scoped deploy
7. API, 보안, 정적 파일 hash, 실물 스캔 검증
8. `docs/NEXT.md`, `TODO.md`, Obsidian 결정 기록 갱신

실데이터가 분포 또는 license gate를 통과하지 못하면 그 소스를 제외하고 이유를 보고한다.
카탈로그 publication, function deploy, Hosting deploy를 성공한 것처럼 계속하지 않는다.
