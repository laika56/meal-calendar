# 밀캘린더 입력 신뢰도·반복 기록 확장 설계

작성일: 2026-08-19
상태: 사용자 승인 완료 — 구현 중

## 목표

밀캘린더의 기존 달력·검색·바코드·프리셋 흐름을 유지하면서 다음 여섯 기능을 추가한다.

1. 영양성분표 촬영 입력
2. 통합 바코드 조회
3. 음식 기록 수정 이력
4. 최근 7일 요약
5. 데이터 내보내기·복구
6. 반복 식사 강화

기능 수보다 입력 성공률과 기록 근거를 우선한다. 영양값을 추측하거나, 외부 조회 결과를
개인 상품 DB로 학습하거나, 건강 조언을 생성하지 않는다.

## 공통 원칙

- 날짜 키는 기존과 같이 Asia/Seoul의 `YYYY-MM-DD`다.
- 사진 원본과 OCR 원문은 서버·Firestore·로컬 저장소에 보존하지 않는다.
- 외부 상품 소스가 준 이름과 브랜드는 영양값의 근거가 아니다.
- 칼로리·탄수화물·단백질·지방은 검증된 DB 결과 또는 사용자가 확인한 포장지 값만 저장한다.
- 모든 외부 조회는 독립적으로 실패할 수 있으며, 한 소스의 장애가 기존 소스의 성공을 막지 않는다.
- 기존 entry와 preset 문서는 마이그레이션하지 않는다. 새 필드는 읽는 쪽에서 선택적으로 처리한다.
- 구현은 여섯 개의 독립 단계로 나누고 각 단계의 자동 검증이 끝난 뒤 다음 단계로 간다.

## 1. 영양성분표 촬영 입력

### 사용자 흐름

바코드 조회와 검색이 모두 실패한 화면에 `영양성분표 촬영`을 제공한다. 사용자가 사진을
선택하거나 카메라로 촬영하면 기기 안에서 OCR을 실행하고 다음 후보를 확인 화면에 채운다.

- 제품명: OCR이 안정적으로 찾지 못하면 비워 둔다.
- 총 내용량 또는 1회 제공량과 단위
- 열량, 탄수화물, 단백질, 지방

각 필드는 사용자가 수정할 수 있다. 필수값은 이름, 양, 열량이다. 탄·단·지는 비어 있어도
되지만 `0`으로 바꾸지 않는다. `추가`를 누르기 전에는 하루 기록을 변경하지 않는다.

### 실행 위치와 의존성

OCR은 브라우저에서만 실행한다. `tesseract.js`의 고정 버전과 한국어·영어 학습 데이터를
촬영 기능을 처음 열 때만 지연 로딩한다. 앱 시작과 일반 바코드 스캔에는 OCR 다운로드 비용을
붙이지 않는다. OCR 자산을 처음 내려받지 못하면 사진과 기존 기록을 잃지 않고 수동 입력으로
전환한다.

사진은 `File`/`ImageBitmap`으로만 처리하고 OCR 완료·취소·화면 닫기 때 참조를 해제한다.
내보내기 데이터에도 사진과 OCR 원문을 포함하지 않는다.

### 파싱 계약

OCR 파서는 순수 함수다. 한국 식품 표시의 `총 내용량`, `1회 제공량`, `열량`, `탄수화물`,
`단백질`, `지방` 표제와 인접 숫자·단위를 찾는다. 단위가 없거나 한 표제에 서로 다른 숫자가
경쟁하면 그 필드는 `null`로 둔다. 숫자와 단위를 분리해 사용자 확인 화면에만 제시하며 자동
저장하지 않는다.

확인 후 생성한 entry에는 `addedBy: "label-scan"`, `source: "nutrition-label"`을 남긴다.
사용자가 확인한 값만 저장하고 OCR 신뢰도나 추출 실패를 영양값으로 해석하지 않는다.

## 2. 통합 바코드 조회

### 조회 순서

1. Firestore의 ready 국내 공용 바코드 카탈로그
2. Open Food Facts
3. UPCitemdb 무료 lookup API

국내 카탈로그와 OFF는 구조화된 영양값이 검증된 경우 바로 기존 양 선택 화면으로 간다.
UPCitemdb는 이름·브랜드·분류·이미지 URL만 제품 식별 후보로 취급한다. description에서 숫자를
파싱해 영양값으로 사용하지 않는다.

### UPCitemdb 처리

무료 endpoint는 Cloud Function에서 호출한다. 클라이언트가 외부 API에 직접 연결하지 않는다.
8초 타임아웃을 적용하고 재시도하지 않는다. 무료 한도·429·장애는 `upcitemdbUnavailable`로
분류하되 기존 국내 카탈로그와 OFF 결과를 바꾸지 않는다.

응답은 닫힌 shape로 검증한다. 정확히 요청한 canonical GTIN과 같은 항목이 하나일 때만
`identity`를 반환한다. 0건, 여러 정체성이 충돌하는 결과, 잘못된 EAN은 정직한 miss다.

UPCitemdb identity를 받으면 제품명과 브랜드를 검색 입력에 채우고 기존 식약처 검색을 실행한다.
식약처 결과를 자동 선택하거나 저장하지 않는다. 사용자가 공식 결과를 고르거나 영양성분표 촬영으로
전환한다.

### 응답 호환성

`GET /api/foods/barcode?code=`는 기존 `{ item }`을 유지하면서 선택적으로
`{ identity, providers }`를 추가한다. 기존 클라이언트는 추가 필드를 무시할 수 있어야 한다.
인증은 모든 외부 조회보다 먼저 수행한다.

## 3. 음식 기록 수정 이력

### entry 확장

기존 entry에 선택적 `revisions`를 추가한다.

```js
revisions: [{
  changedAt: "2026-08-19T12:34:56.000Z",
  reason: "amount" | "nutrition" | "identity",
  before: {
    name, amountG, kcal, carbG, proteinG, fatG,
    estimate, matchedFoodName, source, barcode, nutritionProvenance
  }
}]
```

수정할 때 현재값의 닫힌 snapshot을 `revisions` 끝에 추가하고 최신값을 entry 최상위에 쓴다.
`foodKey`, `addedBy`, 최초 `at`은 바꾸지 않는다. 취소하거나 검증에 실패하면 revision과 하루
totals 모두 바뀌지 않는다.

화면은 최신값만 목록에 표시하고 `수정 이력`에서 시간·변경 종류·이전값을 읽기 전용으로 보여준다.
하루 `totals`는 수정된 slots에서 다시 계산해 같은 `saveDay`에 함께 저장한다.

## 4. 최근 7일 요약

### 기간과 값

선택한 날짜를 끝으로 하는 로컬 날짜 7개를 사용한다. 월 경계를 넘을 수 있으므로 날짜 범위
조회 함수를 추가한다.

- 기록일수: `totals.kcal > 0`인 날짜 수
- 평균 칼로리: 기록일만 합산한 산술평균
- 평균 탄·단·지: 기록일의 각 totals 산술평균
- 체중: 기간 안의 첫 체중과 마지막 체중 및 측정 횟수

기록일이 0이면 평균을 `0`으로 표시하지 않고 `기록 없음`으로 둔다. 체중이 2회 미만이면 변화량을
표시하지 않고 추가 기록이 필요하다고만 말한다. 목표 달성 판정, 식단 평가, 건강 조언은 없다.

### UI

달력 상단 요약에서 `최근 7일`을 열어 별도 sheet로 표시한다. 기존 월 요약과 일간 상세를
대체하지 않는다. 네트워크 실패 시 빈 데이터처럼 보이지 않도록 오류 상태를 구분한다.

## 5. 데이터 내보내기·복구

### 내보내기

설정 화면에서 JSON과 CSV를 생성한다. 생성은 브라우저 안에서 수행하며 별도 서버에 업로드하지
않는다.

JSON root는 닫힌 versioned envelope다.

```js
{
  schema: "meal-calendar-export",
  version: 1,
  exportedAt,
  profile,
  goals,
  days,
  presets,
  dislikes,
  recentEntries
}
```

날짜·preset ID를 canonical 순서로 정렬해 같은 데이터는 `exportedAt`을 제외하고 동일하게 직렬화한다.
CSV는 날짜, 끼니, 음식명, 양, kcal, 탄·단·지, 입력 방식, 추정 여부만 담는 열람용 파일이며 복구
입력으로 사용하지 않는다.

### 복구

JSON 전체를 메모리에서 먼저 검증한다. root와 모든 하위 record에 예상 밖 필드, 잘못된 날짜,
비정상 숫자, 중복 ID가 있으면 쓰기 전에 거부한다. 현재 사용자와 파일의 데이터를 비교해
새 날짜·새 preset 수와 충돌 수를 보여준다.

복구는 기존 날짜와 preset을 덮어쓰지 않는 merge-only다. 충돌 항목은 건너뛰고 개수를 보고한다.
모든 쓰기 결과를 기다리며 일부 실패를 성공으로 표시하지 않는다. 원본 파일은 앱에 저장하지 않는다.

## 6. 반복 식사 강화

### 프리셋 만들기

일간 상세에서 다음 두 동작을 제공한다.

- 특정 끼니를 `한 끼 프리셋`으로 저장
- 하루 전체를 네 끼 슬롯 구조를 가진 `하루 프리셋`으로 저장

기존 단일 entry/entries preset 읽기는 그대로 유지한다. 새 preset은 다음 shape를 쓴다.

```js
{
  schemaVersion: 2,
  label,
  kind: "meal" | "day",
  sourceSlot: "breakfast" | "lunch" | "dinner" | "snack" | null,
  slots,
  createdAt
}
```

프리셋에는 entry의 현재 snapshot만 복사한다. `revisions`는 반복 입력에 복사하지 않는다.

### 적용

한 끼 프리셋은 현재 선택한 슬롯 끝에, 하루 프리셋은 대응 슬롯 끝에 entry 복사본을 추가한다.
각 복사본은 새 `foodKey`를 만들지 않되 새 `at`과 `addedBy: "preset"`을 갖는다. 이후 복사본을
수정해도 preset과 과거 기록은 바뀌지 않는다. 적용 전에 추가될 항목 수와 대상 날짜를 확인한다.

## 보안·개인정보

- UPCitemdb 요청에는 바코드 숫자만 전송한다. 사용자 uid, 날짜, 식단 기록은 전송하지 않는다.
- 영양성분표 사진과 OCR 텍스트는 외부 서비스와 Firestore에 전송하지 않는다.
- export/import는 본인 uid 아래 데이터만 기존 Firestore rules로 읽고 쓴다.
- 새 공용 Firestore namespace를 추가하지 않는다.
- 외부 CDN 의존성은 정확한 버전으로 고정하고 OCR을 열지 않은 세션에서는 로드하지 않는다.

## 오류 처리

- 외부 바코드 소스 장애와 정직한 miss를 구분한다.
- OCR 로드·인식 실패는 수동 입력으로 복구하며 사진을 잃었다고 성공 표시하지 않는다.
- entry 수정은 slots와 totals가 함께 저장된 경우에만 성공 표시한다.
- 주간 요약 로딩 실패는 0건으로 위장하지 않는다.
- import는 검증 완료 전 0 writes, 충돌은 skip, 쓰기 실패는 명시적으로 보고한다.
- preset 적용은 계산·복사 검증이 끝난 뒤 하루 문서를 한 번 저장한다.

## 테스트 전략

### 순수 모듈

- OCR 텍스트 파서: 한국어/영어 표제, g/mL, 누락, 충돌 숫자, 0과 빈 값
- UPCitemdb: canonical barcode, exact hit, miss, 충돌, malformed response, timeout/429
- entry revision: 비변경, snapshot, totals 재계산, 기존 entry 호환
- weekly summary: 0일, 1일, 7일, 월 경계, 체중 0/1/2회
- export/import: canonical JSON, CSV escaping, unknown fields, 중복, merge conflict, nonmutation
- preset v2: meal/day 복사, 기존 preset 호환, revision 제거, 독립 복사

### 통합·UI

- 인증 전에 어떤 외부 바코드 조회도 하지 않는다.
- UPC identity가 영양값으로 자동 승격되지 않는다.
- OCR 사진이 네트워크·Firestore 요청 payload에 포함되지 않는다.
- 수정 후 목록과 totals가 함께 갱신된다.
- 주간 로딩·빈 상태·오류 상태가 서로 다르다.
- import 확인 전 write가 0이다.
- preset 적용 취소 시 하루 데이터가 바뀌지 않는다.
- 서비스워커 shell 목록과 revision digest를 실제 배포 bytes에 다시 결속한다.

### 최종 검증

- focused tests와 전체 `npm test`
- 변경 JS에 `node --check`, `git diff --check`
- Firestore emulator에서 본인 데이터 허용·타 사용자 거부 확인
- 모바일 크기 브라우저에서 여섯 흐름과 콘솔 오류 확인
- 실제 iPhone에서는 카메라, OCR 성능, 파일 다운로드·선택을 별도 확인

## 구현·배포 경계

단계별 구현 커밋은 가능하지만 운영 배포는 여섯 단계의 통합 검증 후 한 번 수행한다. 배포 전 현재
작업 트리의 `public/app.js`, `public/index.html`, `public/sw.js` 미커밋 변경을 별도 변경으로
간주해 보존하고, 최종 diff에서 소유권과 목적을 구분한다. 실제 iPhone 검증 전에는 카메라·OCR이
실기기에서 통과했다고 주장하지 않는다.
