# 구조

## 전체 그림

```
iOS Safari (홈 화면 PWA)
  │
  ├─ Firestore SDK ──────────────► Firestore   (내 데이터. 보안 규칙으로 격리)
  │                                   ▲
  │                                   │ 캐시 쓰기
  └─ fetch /api/* ──► Cloud Functions ┘
                        │
                        ├─► 식약처 통합식품영양성분   (키 필요)
                        ├─► Open Food Facts          (키 불필요)
                        └─► Anthropic API            (키 필요, 선택)
```

**키를 아는 곳은 Cloud Functions 뿐이다.** 프론트는 `/api/*`만 안다.

## 왜 프록시가 필수인가

PWA는 정적 파일이다. 프론트에 넣은 키는 DevTools·소스보기·네트워크 탭에 전부 보인다.
난독화는 방어가 아니다. **프록시가 유일한 방법이다.**

Firebase Web SDK 설정값(`apiKey`, `projectId` 등)은 예외 — 이건 비밀이 아니라 공개 식별자다.
대신 그 경우 **Firestore 보안 규칙이 유일한 방어선**이 된다. 규칙 없이 배포하면 남이 내 데이터를 읽는다.

## 데이터 모델 (Firestore)

```
users/{uid}
  profile          { heightCm, birthYear, sex, activityLevel, updatedAt }
  dislikes         [ foodKey ]            기피 식품. 룰렛이 제외한다
  recentEntries    [ entry ]              Phase 4. 최근 추가한 항목, 이름 기준 dedupe,
                                           최신순 최대 10개. 항목 추가할 때마다 갱신

users/{uid}/goals/{effectiveFrom}        YYYY-MM-DD. 목표는 바뀌므로 이력으로 쌓는다
  { mode, kcal, carbG, proteinG, fatG, bmr, tdee, note }

users/{uid}/days/{YYYY-MM-DD}            ← 로컬(Asia/Seoul) 날짜. UTC 금지
  weightKg
  slots {
    breakfast: [ entry ], lunch: [ entry ], dinner: [ entry ], snack: [ entry ]
  }
  totals           { kcal, carbG, proteinG, fatG }   읽기 최적화용 비정규화
  rouletteSeed     재현 가능한 룰렛을 위한 시드

users/{uid}/presets/{presetId}           1-Click 고정 식품
  { label, entry }

foods/{source}_{code}                    공용 캐시. 외부 API 쿼터 절약
  { source, code, name, per100g:{...}, servingG, fetchedAt }
```

### entry 형태

```js
{
  foodKey:  "mfds_D000123",   // {source}_{code}. 수동 입력은 "manual_<uuid>"
  name:     "닭가슴살 구이",
  amountG:  150,
  kcal, carbG, proteinG, fatG,  // amountG 기준으로 이미 환산된 값
  addedBy:  "manual" | "quick" | "search" | "barcode" | "preset" | "roulette",
  estimate: {                    // 빠른 기록에서 대표 중량을 쓴 경우에만 존재
    displayAmount,               // 사용자가 쓴 단위, 예: "2개"
    source, sourceLabel,         // 대표 중량 근거
    matchedFoodName              // 실제 식약처 검색에서 고른 항목
  },
  at:       serverTimestamp
}
```

**환산값을 저장한다.** per100g만 저장하고 매번 계산하면, 나중에 DB가 수치를 고쳤을 때
과거 기록이 소급해서 바뀐다. 먹은 날의 기록은 그날 값으로 고정되어야 한다.

### 왜 `totals`를 중복 저장하나

캘린더는 한 화면에 30~31일을 그린다. 날마다 slots를 다 읽어 합치면 읽기 횟수가 30배가 된다.
`totals`만 읽도록 쿼리를 구성한다. **쓰기 시점에 갱신하며, 갱신 누락이 곧 버그다** — 테스트로 잠근다.

## 보안 규칙 — **배포됨** (2026-08-13)

실제 파일은 `firestore.rules`. 배포: `firebase deploy --only firestore:rules`.
이 문서는 무엇을 왜 막는지만 적는다 — 규칙 본문은 그 파일이 단일 출처다.

| 경로 | 읽기 | 쓰기 | 왜 |
|---|---|---|---|
| `users/{uid}/**` | 본인만 | 본인만 | 개인 건강 데이터. 익명 uid라도 uid는 발급되므로 격리가 성립한다 |
| `foods/{doc}` | 로그인 사용자 | **거부** | 공용 캐시. 클라이언트가 쓸 수 있으면 남의 검색 결과를 오염시킨다. Cloud Functions(Admin SDK)는 규칙을 우회하므로 쓸 수 있다 |
| 그 외 전부 | 거부 | 거부 | 새 컬렉션을 추가하면 여기서 막힌다. **그게 의도다** — 규칙을 먼저 쓰지 않으면 데이터가 안 들어간다 |

**실측 확인 (2026-08-13, 배포된 규칙에 대해 브라우저에서 직접):**

| 시도 | 결과 |
|---|---|
| 남의 uid 문서 읽기 | `permission-denied` ✅ |
| `foods/` 쓰기 | `permission-denied` ✅ |
| 명세에 없는 최상위 컬렉션 쓰기 | `permission-denied` ✅ |
| 본인 `profile`·`goals` 읽기 | 통과 ✅ |
| `foods/` 읽기 | 통과 ✅ |

> **규칙 함수 위치 주의:** `isSignedIn()`/`isOwner()` 같은 헬퍼는 `service` 블록 **안**에 둬야 한다.
> 파일 최상단(`service` 밖)에 쓰면 컴파일이 안 된다.

인증 상태는 미로그인·비회원(익명)·회원(이메일/비밀번호) 세 가지다. 첫 진입에서는 사용자가
회원가입/로그인/비회원 시작 중 하나를 고른다. 비회원이 설정에서 회원으로 전환할 때는
`linkWithCredential`로 기존 익명 uid에 이메일 자격을 붙인다. uid가 바뀌지 않으므로 Firestore
데이터 이동도, 보안 규칙 변경도 필요 없다.

인증 구독은 `onIdTokenChanged`를 쓴다. 자격 연결은 uid가 그대로라 `onAuthStateChanged`가 다시
불리지 않을 수 있지만 ID 토큰은 바뀐다. 이 이벤트를 놓치면 회원 전환은 성공해도 설정 화면이
비회원 상태로 남아 새로고침을 요구하게 된다.

중복 이메일로 전환하려는데 현재 익명 uid에 기록이 있으면 자동 로그인하지 않는다. 먼저
Firestore의 날짜 문서 수를 세어 "N일치가 넘어가지 않는다"고 표시하고, 사용자가 명시적으로
기록 포기를 두 번 확인해야 기존 계정으로 바꾼다. 비회원은 앱 데이터/인증 상태를 지우기 전에
회원 전환해야 다른 기기에서 복구할 수 있다.

## Cloud Functions 엔드포인트

| 경로 | 하는 일 | 상태 |
|---|---|---|
| `GET /api/foods/search?q=` | 식약처 검색 → 정규화 → `foods/` 캐시에 upsert | **배포됨 (2026-08-13)** |
| `GET /api/foods/barcode?code=` | ready 공용 국내 바코드 카탈로그 exact 조회 | **배포됨 (2026-08-19)** |
| `POST /api/roulette/explain` | (선택) solver 결과에 설명 문구. **숫자를 만들지 않는다** | Phase 6 |

전부 인증 필요. 익명 uid라도 토큰 검증은 한다 — 안 하면 남이 내 쿼터를 태운다.

바코드는 `barcodeCatalogRuns/{runId}/foods/{canonicalBarcode}`의 versioned run을 마지막
transaction에서 `barcodeCatalogState/current`가 가리키게 한다. 브라우저의 직접 read/write는
rules로 닫고 `barcodeFood`만 Admin SDK로 읽는다. 앱은 이 공용 조회가 miss/장애일 때만 OFF를
호출하며, 스캔 결과를 공용 DB에 쓰거나 개인 학습 데이터로 축적하지 않는다.

### `searchFoods` 구현 메모

- `functions/index.js`, 리전 `asia-northeast3` (Firestore와 동일 — 레이턴시), **Blaze 요금제 필요**
  (2026-08-13 업그레이드함. 무료 할당량 안에서는 $0, 예산 알림 $5 걸어둠)
- `Authorization: Bearer <Firebase ID 토큰>` 검증 후에만 동작. 실측: 토큰 없으면 401
- `MFDS_API_KEY`는 Secret Manager에 저장 (`firebase functions:secrets:set`), 코드·로그에 안 남음
- **함정 — 서비스키 이중 인코딩:** `MFDS_API_KEY`는 공공데이터포털에서 발급된 그대로
  퍼센트 인코딩된 상태로 저장돼있다. `URLSearchParams.set('serviceKey', key)`로 그냥 넣으면
  **다시 인코딩돼 키가 깨진다** — MFDS가 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`로 응답해서
  실측으로 잡았다. `decodeURIComponent(key)`로 원본으로 되돌린 뒤 넣어야 한다
- **개별 항목 파싱 실패는 검색 전체를 안 죽인다** — `src/lib/mfdsParser.js`의
  `parseMfdsFoodItem`(strict, 한 건이라도 이상하면 던짐)을 개별 항목마다 try/catch로 감싸서
  실패한 항목만 건너뛴다. 검색 API처럼 여러 건을 한 번에 받는 곳엔 strict 파서를 그대로 못 쓴다
- `src/lib/mfdsParser.js`는 `functions/` 밖이라 Cloud Functions 배포에 안 실린다 —
  `functions/shared/mfdsParser.js`에 복사본을 둔다. **원본이 진실의 원천, 복사본은 손으로 동기화**
  (`functions/lib/`가 아니라 `functions/shared/`인 이유: `.gitignore`가 `functions/lib/`를
  TS 빌드 산출물로 이미 막아뒀었다 — 이름 충돌 피하려고 옮겼다)
- Hosting rewrite에도 `region: asia-northeast3`를 명시한다. 생략하면 로컬 Hosting 서버가 배포된
  함수를 `us-central1`로 잘못 찾아 404를 반환했다. 운영·로컬 모두 함수 리전은 한 곳에서 일치시킨다

## 오프라인

- Firestore 오프라인 퍼시스턴스 활성화
- 서비스워커는 **앱 셸만** 캐싱한다. 영양 데이터는 Firestore가 알아서 한다
- 실패한 쓰기를 조용히 삼키지 않는다. UI에 "저장 대기 중" 상태를 노출한다

## iOS PWA 제약 (실기기 확인 완료, 2026-08-13)

- HTTPS 필수 — PWA 설치와 `getUserMedia`(카메라) 둘 다. **확인됨**
- `BarcodeDetector` 없음 → `zxing-wasm`. **확인됨**
- **standalone 모드에서 카메라 권한이 앱 재실행마다 다시 초기화된다.** 한 번 허용해도 유지 안 됨 —
  Phase 8(바코드) UX가 이걸 전제로 설계돼야 한다
- safe-area inset 처리 필요 (노치·홈 인디케이터). **확인됨**
- 홈 화면 아이콘은 `apple-touch-icon` + manifest 둘 다 넣는다. **확인됨**

## 배포 구조 — Hosting은 프로젝트 루트 전체를 서빙한다

`public/`만 배포하면 `src/lib/`(계산 엔진·파서, 빌드 없이 브라우저가 직접 import)에 못 닿는다.
그렇다고 번들러를 넣진 않는다(빌드 스텝 없음은 확정 사항). 대신:

- `firebase.json`의 `hosting.public`은 `"."` — 리포 루트 전체가 서빙 대상
- `rewrites`로 `/` → `/public/index.html` — URL은 루트, 실제 파일은 `public/` 안
- `index.html`의 manifest·아이콘 링크는 `/public/...` 절대경로 (루트 URL 기준 상대경로라 `./`로 쓰면 깨진다)
- `manifest.webmanifest`의 `start_url`/`scope`는 `/` — 아이콘 경로는 `./icon-*.png` 그대로 둔다
  (매니페스트 자신의 URL이 `/public/manifest.webmanifest`라 상대경로가 `/public/icon-*.png`로 정확히 풀린다)
- `firebase.json`의 `ignore`에 `docs/`·`tests/`·`scripts/`·`.git`·`.env*` 등을 명시적으로 뺀다.
  **`.gitignore`는 배포 범위와 무관하다** — `firebase deploy`는 로컬 파일을 git 상태와 상관없이 그대로 올린다.
  실측: `curl .../.env` `.../tests/...` `.../.git/config` 전부 404 확인 완료

### 서비스워커 스코프 — 파일 위치가 아니라 등록 경로가 스코프를 정한다

Phase 1에서 실제로 걸렸던 함정 두 개, 둘 다 배포는 성공했는데 브라우저에서 "안 바뀐 것처럼" 보이는
버그라 배포 로그만 봐선 못 잡는다.

1. **SW 등록 경로가 스코프를 정한다.** `navigator.serviceWorker.register('/public/sw.js')`처럼
   부르면 스코프가 스크립트가 있는 디렉터리(`/public/`)로 좁아진다. **루트 문서(`/`)는 그 스코프
   밖이라 SW가 아예 못 건드린다.** `firebase.json`에 `{ "source": "/sw.js", "destination": "/public/sw.js" }`
   rewrite를 추가해 **루트 경로(`/sw.js`)로 서빙되게 만들고**, 등록도 `register('/sw.js')`로 한다.
   실제 파일은 `public/sw.js`에 그대로 둔다 — rewrite가 경로만 바꿔준다.
2. **`Cache-Control: max-age=3600`이 SW 캐시와 별개로 브라우저 HTTP 캐시에도 걸린다.** SW를
   cache-first에서 network-first로 고쳐도, `app.js`/`index.html` 자체가 브라우저 디스크 캐시에
   1시간 박혀있으면 재배포해도 그 캐시가 안 풀린다. **JS·HTML은 `Cache-Control: no-cache,
   must-revalidate`로 명시** (`firebase.json`의 `headers`). 아이콘·매니페스트 같은 정적 자산은
   기본 캐싱을 유지해도 된다 — 내용이 자주 안 바뀐다.

**디버깅 방법:** `curl`은 SW·브라우저 캐시를 안 타므로 서버가 실제로 뭘 주는지 확인하는 데 쓴다.
브라우저에서 안 바뀌어 보이면 `navigator.serviceWorker.getRegistrations()`로 스코프를,
`caches.keys()`로 캐시 이름을 직접 찍어본다.

`src/lib/*.js`를 화면 스크립트에서 쓸 땐 `import { calcBMR } from '/src/lib/metabolism.js'`처럼
루트 기준 절대경로로 부른다.
