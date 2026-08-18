# 프랜차이즈 통합 카탈로그 설계

작성일: 2026-08-18

## 목적

밀캘린더에서 `써브웨이 이탈리안 비엠티`, `맥도날드 빅맥`처럼 브랜드와 메뉴를 함께
검색했을 때 실제 영양정보가 검색 결과에 나타나게 한다. 특정 브랜드를 애플리케이션 코드에
하드코딩하지 않고, 공공데이터에 포함된 모든 프랜차이즈를 받아들이며 공식 자료가 확보된
브랜드를 같은 구조로 계속 보강한다.

이 설계에서 “모든 프랜차이즈”는 인터넷의 모든 메뉴를 무근거로 수집한다는 뜻이 아니다.
승인된 공공데이터 또는 브랜드 공식 자료에서 출처와 기준값을 확인할 수 있는 모든 브랜드를
단일 파이프라인으로 수용한다는 뜻이다. 확인되지 않은 영양값은 생성하지 않는다.

## 현재 상태와 문제

현재 `searchFoods` Cloud Function은 식약처 API를 실시간 조회하고 검색 결과를 `foods/`에
캐시한다. 식약처 API에는 프랜차이즈 원천 구분과 제조사 필드가 있지만 검색 가능한 메뉴가
완전하지 않다. 2026-08-18 직접 조회 결과 `써브웨이`, `서브웨이`, `이탈리안 비엠티`는 모두
0건이었다.

한국 써브웨이 공식 이탈리안 비엠티 페이지에는 228g, 388kcal, 단백질 21g 등의 값이
공개돼 있지만 총 탄수화물과 총 지방은 없다. 따라서 공식 페이지의 일부 숫자를 완전한
탄·단·지 레코드로 가장해서는 안 된다.

## 범위

### 포함

- 공공데이터 프랜차이즈 항목의 반복 가능한 일괄 적재
- 공식 브랜드 메뉴의 검수된 보강 데이터 적재
- 브랜드 및 메뉴 별칭 정규화
- 내부 카탈로그와 기존 식약처 실시간 검색 결과 병합
- 출처, 기준일, 검증일, 신뢰도 표시
- 영양값이 불완전한 메뉴의 안전한 수동 보완 흐름
- 비활성 메뉴와 데이터 변경 이력 보존
- 데이터 검사, dry-run, 중복 및 단위 검증

### 제외

- 브랜드 웹사이트의 무단 실시간 스크래핑
- 출처에 없는 영양값 추정
- 사용자 주문·결제 연동
- 써브웨이 빵·치즈·소스 전체 조합 계산
- PostgreSQL 또는 Supabase 신규 도입
- 기존 사용자 식단 문서 구조의 파괴적 변경

조합형 메뉴는 카탈로그가 안정화된 뒤 별도 설계로 진행한다. 이번 단계에서는 공식 페이지가
말하는 기준 메뉴 한 건을 하나의 메뉴 레코드로 취급한다.

## 접근안과 선택

### 브랜드별 코드 하드코딩

초기 구현은 빠르지만 브랜드 추가와 데이터 갱신마다 코드 배포가 필요하고 출처 이력을
관리하기 어렵다. 채택하지 않는다.

### 별도 관계형 데이터베이스

복잡한 옵션과 이력에는 유리하지만 현재 Firebase 기반 앱에 인증, 배포, 운영 경계를 하나 더
추가한다. 조합형 메뉴의 실제 수요가 확인되기 전에는 채택하지 않는다.

### Firestore 통합 카탈로그

현재 인증, Functions, Hosting을 유지한다. 수집기는 검수된 파일을 Firestore 카탈로그로
적재하고, 검색 Function이 카탈로그와 식약처 실시간 결과를 병합한다. 이번 설계의 선택이다.

## 데이터 출처 우선순위

1. `official_brand`: 국내 브랜드 공식 영양정보
2. `public_data`: 식약처 또는 공공데이터포털의 프랜차이즈 제공 영양정보
3. `general_reference`: 일반 음식 참고값

우선순위는 “공식이면 모든 필드가 완전하다”는 뜻이 아니다. 각 필드는 실제 출처에 존재하는
값만 저장한다. 공식 메뉴에 kcal만 있고 탄수화물이 없으면 kcal의 출처만 공식이며 탄수화물은
`null`이다.

동일 브랜드·메뉴·제공량의 중복 후보에서는 최신 공식 자료가 표시 우선권을 갖는다. 공공데이터
레코드는 삭제하지 않고 근거 이력으로 유지한다.

## Firestore 모델과 원자적 버전 전환

카탈로그를 활성 컬렉션에 직접 여러 batch로 덮어쓰지 않는다. Firestore batch 한도보다
레코드가 많을 때 중간 실패가 발생하면 사용자가 반쪽짜리 카탈로그를 보게 되기 때문이다.
모든 데이터는 새로운 run 아래에 먼저 적재하고 검증한 뒤, 현재 run 포인터 문서 하나만
transaction으로 전환한다. 검색은 포인터가 가리키는 완료 run만 읽는다.

```text
franchiseCatalogState/current
franchiseCatalogRuns/{runId}
franchiseCatalogRuns/{runId}/brands/{brandId}
franchiseCatalogRuns/{runId}/foods/{foodId}
franchiseCatalogRuns/{runId}/sources/{sourceId}
```

`franchiseCatalogState/current`는 `runId`, 전체 레코드 수, 입력 manifest hash, 게시 시각을
갖는다. `franchiseCatalogRuns/{runId}`는 `status: staging | ready`, 동일한 수와 hash를 갖는다.
여러 batch 적재 중 실패한 staging run은 현재 포인터에 연결되지 않으므로 검색에 노출되지
않는다. 이전 ready run은 변경 이력과 rollback 근거로 보존한다.

### `franchiseCatalogRuns/{runId}/brands/{brandId}`

```js
{
  name: '써브웨이',
  normalizedName: '써브웨이',
  aliases: ['서브웨이', 'subway'],
  category: '샌드위치',
  officialUrl: 'https://www.subway.co.kr/',
  active: true,
  createdAt,
  updatedAt
}
```

`brandId`는 정규화된 브랜드명으로부터 생성한 안정적인 slug다. 별칭은 중복 없이 정렬한다.

### `franchiseCatalogRuns/{runId}/foods/{foodId}`

```js
{
  brandId: 'subway',
  brandName: '써브웨이',
  name: '이탈리안 비엠티',
  aliases: ['이탈리안BMT', 'Italian B.M.T.'],
  normalizedName: '이탈리안 비엠티',
  searchTokens: ['써브웨이', '서브웨이', 'subway', '이탈리안', '비엠티', 'bmt'],
  category: '샌드위치',
  basis: { amount: 228, unit: 'g', label: '1인분' },
  nutrients: {
    kcal: 388,
    carbG: null,
    proteinG: 21,
    fatG: null,
    sugarG: 8.6,
    sodiumMg: 1064
  },
  sourceId: 'subway-menu-1528',
  sourceType: 'official_brand',
  sourceUrl: 'https://www.subway.co.kr/menuView/sandwich?menuItemIdx=1528',
  sourceUpdatedAt: null,
  verifiedAt: '2026-08-18T00:00:00.000Z',
  confidence: 'official',
  active: true,
  createdAt,
  updatedAt
}
```

예시 숫자는 위 공식 페이지에서 확인한 값이다. `null`은 누락된 값이지 0이 아니다.

`foodId`는 `sourceType + sourceRecordId`에서 결정적으로 만든다. 이름이 바뀌어도 같은 원자료
레코드는 같은 ID를 유지한다.

### `franchiseCatalogRuns/{runId}/sources/{sourceId}`

```js
{
  type: 'official_brand',
  name: '써브웨이 코리아 메뉴',
  url: 'https://www.subway.co.kr/',
  licenseNote: null,
  checkedAt,
  active: true
}
```

각 ready run 자체가 당시의 전체 브랜드·메뉴·출처 스냅샷이다. 메뉴값이 바뀌어도 이전 ready
run을 수정하거나 삭제하지 않는다. 사용자의 과거 식단 기록도 원래 저장된 숫자를 유지하며
최신 카탈로그 값으로 다시 계산하지 않는다.

## 검수 파일과 적재기

저장소에는 배포 가능한 검수 데이터만 둔다.

```text
data/franchise/
  sources.json
  brands.json
  official/subway.json
  public/mfds-franchise.json
```

각 데이터 파일은 원자료 URL, 조회일, 원자료 레코드 ID, 원본 기준 단위와 값을 포함한다.
공식 페이지나 공공데이터에서 확인하지 않은 숫자는 파일에 넣지 않는다.

`scripts/import-franchise-catalog.mjs`는 다음 모드를 제공한다.

- 기본값: 검증과 변경 요약만 수행하는 dry-run
- `--apply`: 검증 통과 후 Firestore batch로 upsert
- `--source <id>`: 특정 출처만 제한적으로 실행

적재 전 검증 항목:

- 출처 URL과 source record ID 존재
- brand ID와 food ID 중복 없음
- 허용 단위 `g`, `mL`, `개`, `잔`, `조각`, `15cm`, `30cm`
- 숫자는 유한한 0 이상 값 또는 `null`
- kcal를 포함해 최소 하나의 영양값 존재
- `official_brand`는 공식 도메인 URL만 허용
- 검색 별칭과 토큰의 정규화 및 중복 제거
- 기존 레코드 변경 시 history revision 생성 계획 출력
- 입력 파일 해시와 적재 건수 출력

적재기는 비밀키를 출력하지 않으며 서비스 계정은 기존 Firebase Admin 자격증명을 사용한다.

## 검색 흐름

1. 사용자의 검색어를 기존 `buildSearchPlan`으로 정규화한다.
2. `franchiseCatalogState/current`의 run ID를 읽고, 정규화 결과에서 가장 구체적인 브랜드 또는
   메뉴 토큰 하나를 골라 그 run의 `foods` subcollection을
   `searchTokens array-contains`로 조회한다. 단일 조회 상한은 100건이며,
   모든 토큰 일치 여부와 최종 순위는 Function의 기존 순수 정렬 로직에서 판정한다.
3. 기존 식약처 실시간 검색을 실행한다.
4. 두 결과를 `sourceType`, 브랜드 일치, 메뉴명 일치, 제공량 기준으로 중복 제거하고 정렬한다.
5. 동일 메뉴에서는 공식 브랜드 자료를 우선 표시한다.
6. 카탈로그 조회 실패와 식약처 조회 실패를 구분해 기록한다. 한 공급원의 실패가 다른 공급원의
   정상 결과를 지우지 않는다.

검색 응답의 공통 형상:

```js
{
  foodKey,
  name,
  category,
  maker,
  isFranchise: true,
  serving,
  nutrients,
  completeness: 'complete' | 'partial',
  source: {
    type: 'official_brand' | 'public_data' | 'general_reference',
    label: '공식값' | '공공데이터' | '참고값',
    url,
    verifiedAt
  }
}
```

기존 식약처 응답도 이 공통 형상으로 변환하되 이전 필드는 호환 기간 동안 유지한다.
현재 UI가 소비하는 `per100g` 호환 필드는 다음 규칙으로만 만든다.

- 기준 단위가 `g`이면 `basis.amount`의 영양값을 정확히 `100 / basis.amount` 배율로 환산한다.
- 기준 단위가 `mL`이면 기존 `basis: 'mL'` 계약에 맞춰 100mL 기준으로 같은 방식으로 환산한다.
- `개`, `잔`, `조각`, `15cm`, `30cm`처럼 질량·부피가 아닌 기준은 공식 제공량 값과
  `serving`을 그대로 쓰며 g으로 변환하지 않는다.
- 원본에서 `null`인 영양값은 환산 뒤에도 `null`이다.

검색어가 브랜드명 하나뿐이라 결과가 100건을 넘으면 최신 활성 메뉴 100건과
`hasMore: true`를 반환한다. UI는 검색어를 더 구체적으로 입력하라는 문구를 표시한다.

## 불완전 영양정보 처리

현재 자동 기록은 kcal·탄수화물·단백질·지방이 모두 있어야 한다. 이 안전 규칙을 유지한다.

- 완전한 결과: 기존 양 선택과 자동 기록으로 진행
- 불완전한 결과: 공식 제공량과 확인된 값만 수동 입력 폼에 채움
- 누락 필드는 빈칸이며 0으로 보이지 않음
- 화면에 `공식 자료에 없는 탄수화물·지방은 직접 입력해야 합니다.`라고 표시
- 사용자가 누락값을 입력하기 전에는 저장하지 않음
- 사용자가 입력한 필드와 공식 필드의 출처를 식단 기록에 구분해 남김

부분 영양정보를 허용하는 일별 합계 모델 변경은 이번 범위에서 하지 않는다. 불완전 레코드를
억지로 합산하지 않기 위해서다.

## UI

검색 결과 한 줄은 다음을 표시한다.

```text
이탈리안 비엠티
써브웨이 · 공식값 · 1인분 228g · 388kcal
```

공식값, 공공데이터, 참고값은 기존 색 토큰을 사용해 구분한다. 새 색을 만들지 않는다.
결과 상세 또는 수동 보완 화면에서 출처 링크와 검증일을 볼 수 있게 한다.

검색 결과가 없을 때의 기존 “한 번만 넣어두면 다음부터 1탭” 흐름은 유지한다.

## 보안과 권한

- 외부 API 키는 계속 Cloud Functions secrets에만 둔다.
- 클라이언트는 Firestore 카탈로그를 직접 읽거나 쓰지 않는다.
- 검색은 기존 인증된 `/api/foods/search`를 통해서만 제공한다.
- 적재 권한은 Admin SDK 실행 환경에만 있다.
- Firestore 보안 규칙은 카탈로그 state와 모든 run에 대한 사용자 읽기·쓰기를 거부한다.
- 데이터 라이선스와 제3자 권리는 실제 초기 적재 전에 출처별로 확인한다.

## 오류 처리

- 카탈로그 장애 + 식약처 성공: 식약처 결과와 `catalogUnavailable: true`
- 카탈로그 성공 + 식약처 장애: 카탈로그 결과와 `mfdsUnavailable: true`
- 둘 다 장애: HTTP 502와 현재 검색 실패 문구
- 데이터 레코드 검증 실패: 해당 레코드를 건너뛰지 않고 전체 적재를 거부
- 캐시 저장 실패: 검색 결과는 반환하되 구조화 로그 기록
- 출처가 사라지거나 값이 달라짐: 자동 추측 갱신 없이 검수 필요 상태로 전환

## 테스트

### 순수 로직

- 브랜드·메뉴·별칭 정규화
- `써브웨이`와 `서브웨이`가 같은 브랜드로 매칭
- 공식·공공 중복에서 공식값 우선
- 다른 제공량이나 사이즈는 병합하지 않음
- 완전/불완전 영양값 판정
- null과 0 구분
- 입력 non-mutation 및 결정적 정렬

### 적재기

- dry-run 무쓰기
- 중복 ID, 잘못된 URL, 음수/NaN, 미지원 단위 거부
- 같은 입력의 반복 실행이 동일 결과
- 변경 시 history 생성, 무변경 시 history 없음
- 실패 시 부분 적재 없음

### Function과 UI

- 내부 카탈로그와 식약처 결과 병합
- 공급원 한쪽 장애 시 다른 쪽 결과 유지
- 부분 레코드 자동 저장 거부 및 수동 폼 정확한 prefill
- 출처 라벨·URL·검증일 표시
- 기존 일반 음식, 바코드, 빠른 입력 회귀 유지
- 전체 `npm test`

## 출시 순서

1. 순수 정규화·검증·병합 모듈과 테스트
2. Firestore 모델과 dry-run 적재기
3. 공공데이터 프랜차이즈 초기 검수 파일
4. 써브웨이 공식 메뉴를 첫 보강 데이터로 적재
5. 검색 Function 병합
6. UI 출처·불완전 영양정보 표시
7. 로컬 에뮬레이터 검증
8. 사용자 승인 후 카탈로그 적재, Functions·Hosting 배포
9. 실제 `서브웨이 이탈리안BMT`, `맥도날드 빅맥`, 일반 음식 검색 실측

## 완료 기준

- `써브웨이`와 `서브웨이` 검색이 같은 공식 메뉴 결과를 반환한다.
- 이탈리안 비엠티가 1인분 228g, 388kcal, 단백질 21g으로 표시된다.
- 공식 자료에 없는 탄수화물·지방은 빈칸이고 자동 기록되지 않는다.
- 공공데이터의 모든 검증 통과 프랜차이즈 항목이 브랜드 하드코딩 없이 검색된다.
- 공식 보강 데이터를 추가할 때 애플리케이션 코드를 수정하지 않는다.
- 모든 메뉴에 출처 유형, URL, 검증일이 있다.
- 기존 일반 음식·바코드 검색과 전체 테스트가 회귀하지 않는다.

## 후속 범위

- 써브웨이 빵·치즈·소스·토핑 조합 계산
- 메뉴 신고·관리자 검수 UI
- 정기 갱신 자동화와 출처 변경 감지
- 데이터 규모가 Firestore 검색 한계를 넘을 때 전문 검색 인덱스 검토
- 조합·번들 관계가 실제 운영 부담이 될 때 PostgreSQL 전환 검토
