# Franchise Search and Barcode Completion Design

## Goal

프랜차이즈 검색의 배포 환경 장애를 근거 기반으로 진단·수정하고, iOS standalone PWA에서
실제 포장식품 바코드를 스캔해 Open Food Facts 결과를 기존 항목 추가 흐름으로 넘긴다.

## Scope

- 식약처 `searchFoods`의 Cloud Function timeout 진단과 관찰된 원인에 대한 최소 수정
- Open Food Facts 응답 파서의 `nutriments` 전체 결측 경계 보강
- 바코드 카메라 스캔, OFF 조회, 기존 양 선택·추가 완료 화면 연결
- 서비스워커 셸·정적 HTML·순수 로직 테스트와 배포 후 smoke test

다음은 범위 밖이다.

- 영양 수치 추정
- OFF `serving_size` 자유텍스트 파싱
- 새로운 데이터 공급자 또는 유료 API 도입
- 프레임워크·번들러 도입
- Firestore 보안 규칙 변경

## Existing Evidence

- 2026-08-18 Cloud Function 로그에서 식약처 요청이 정확히 8초 뒤
  `The operation was aborted due to timeout`으로 반복 실패했다.
- 동일 `.env` 키와 공식 엔드포인트를 로컬 `scripts/verify-mfds.mjs 김밥`으로 호출하면
  3.2초 안에 100건을 받았고 100건 모두 파싱됐다.
- 따라서 식약처 API 전체 장애 또는 파서 실패로 단정하지 않는다. Cloud Function의 실제
  인증 요청을 다시 측정해 Cloud→식약처 경로, 배포 설정, 일시 장애 중 무엇인지 확정한다.

## Franchise Search Diagnosis

수정 전 아래 경계를 각각 기록한다.

1. 로컬 공식 API 직접 호출의 상태·소요시간·항목 수
2. 배포 Hosting rewrite의 인증 거부가 정상인지
3. 인증된 배포 검색의 상태·소요시간·Cloud 로그 trace
4. Cloud 로그에서 실패가 DNS, 연결, timeout, HTTP, 응답 파싱 중 어디인지

판정 규칙은 다음과 같다.

- 로컬과 배포가 모두 성공하면 일시 장애로 기록하고 임의 재시도·timeout 변경을 넣지 않는다.
- 로컬은 성공하고 배포만 실패하면 Cloud 경계에서 재현 테스트를 만든 뒤 그 경계만 수정한다.
- 로컬도 실패하면 공급자/키 문제로 분류하고 앱 코드로 숨기지 않는다.
- 새 키, 과금, 공급자 교체가 필요하면 구현을 멈추고 사용자 승인을 받는다.

완료 판정은 인증된 `맥도날드 빅맥` 검색이 `200`을 반환하고, 결과의 `maker`와
`isFranchise`가 식약처 원자료에서 온 값으로 유지되는 것이다. 외부 장애가 계속되면 거짓
성공으로 처리하지 않고 기존 오류 문구를 유지한다.

## Barcode Architecture

Open Food Facts는 키가 없고 브라우저 CORS 조회가 가능하므로 Cloud Function을 추가하지 않는다.
클라이언트에서 아래 흐름으로 직접 조회한다.

1. 사용자가 항목 추가 시트의 `바코드 스캔` 버튼을 누른다.
2. 그때만 `getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })`를 호출한다.
3. 카메라가 열린 뒤 `zxing-wasm@3.1.3` reader IIFE를 고정 URL에서 지연 로딩한다.
4. `<video>` 프레임을 숨은 `<canvas>`의 `ImageData`로 옮기고, 이전 판독이 끝난 경우에만
   다음 `requestAnimationFrame`에서 `readBarcodes`를 호출한다.
5. 허용 형식은 `EAN13`, `EAN8`, `UPCA`, `UPCE`, 최대 결과는 1개다.
6. 첫 유효 결과를 잠근 즉시 모든 `MediaStreamTrack`을 정지한다.
7. `https://world.openfoodfacts.org/api/v2/product/{barcode}.json`을 조회하고
   `parseOffProduct`로 정규화한다.
8. 영양정보가 있으면 기존 검색 결과의 양 선택·추가 완료 흐름으로 넘긴다. `g` 또는 `ml`
   기준만 사용하며 1인분은 추정하지 않는다.
9. 제품 없음, 영양정보 없음, 카메라 실패, decoder 로드 실패는 모두 카메라를 닫고 수동 입력으로
   돌아간다. 제품명이 있으면 이름 입력에만 채우고 영양값은 채우지 않는다.

## Barcode UI Contract

- 진입 버튼: `바코드 스캔`
- 스캔 제목: `바코드를 비춰주세요`
- 취소 버튼: `취소`
- 조회 중: `제품 정보를 확인하고 있습니다.`
- 제품 없음: `Open Food Facts에서 제품을 찾지 못했습니다. 직접 입력해 주세요.`
- 영양정보 없음: `제품은 찾았지만 영양정보가 없습니다. 직접 입력해 주세요.`
- 카메라/decoder 실패: `카메라를 사용할 수 없습니다. 직접 입력해 주세요.`

시트 닫기, 취소, 성공, 오류, 페이지 숨김에서 같은 `stopBarcodeScanner()`를 호출한다.
카메라 스트림이 남은 상태로 다른 화면으로 이동하는 경로는 허용하지 않는다.

## Pure Interfaces

`src/lib/barcodeProduct.js`가 다음 순수 인터페이스를 제공한다.

```js
export function normalizeRetailBarcode(results)
// -> string | null; EAN13/EAN8/UPCA/UPCE만 허용

export function buildOpenFoodFactsUrl(barcode)
// -> https://world.openfoodfacts.org/api/v2/product/{encoded}.json

export function toBarcodeFood(parsed)
// -> 기존 검색 결과 화면이 소비하는 food 객체 | null
```

네트워크·DOM·카메라는 `public/app.js`에 남기고, 판독 결과 선택·URL·OFF→앱 객체 변환은
순수 함수로 테스트한다.

## Error and Data Rules

- `product.nutriments` 객체 전체가 없으면 네 핵심 영양 필드를 모두 `null`로 처리한다.
- 값이 있는데 문자열, `NaN`, 무한대, 음수이면 기존처럼 거부한다.
- OFF에 없는 제품은 정상적인 `null` 결과다.
- OFF 결과를 MFDS 결과로 가장하지 않는다. 저장 시 `source: 'off'`, barcode를 유지한다.
- OFF가 제공하지 않은 maker, 1인분, 영양값을 만들지 않는다.
- 카메라 권한은 iOS standalone 재실행마다 다시 요청될 수 있음을 UI·검증 기록에 남긴다.

## Testing

- OFF 전체 `nutriments` 결측 RED→GREEN
- 허용/비허용 barcode format, 빈 결과, 여러 결과 중 첫 유효 결과
- OFF URL encoding과 입력 거부
- OFF g/ml 객체가 기존 food 객체로 정확히 변환되는지
- 제품 없음·영양정보 없음이 수동 입력으로 가는지
- 성공·취소·오류·시트 닫기에서 track stop이 호출되는지
- HTML에 승인 문구와 카메라 요소가 있는지
- 서비스워커 셸에 모든 새 로컬 import가 있는지
- 전체 `npm test`
- 배포 후 Hosting 200, 새 정적 자산 200, 인증 검색, iPhone 실물 바코드 체크리스트

## Deployment

테스트와 diff 검사가 모두 통과한 뒤 변경 파일만 커밋한다. 식약처 원인 수정이 Functions에
있을 때만 Functions를 배포하고, 바코드 UI·서비스워커는 Hosting에 배포한다. Firestore 규칙과
비밀키는 배포하지 않는다.
