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
  addedBy:  "manual" | "barcode" | "preset" | "roulette",
  at:       serverTimestamp
}
```

**환산값을 저장한다.** per100g만 저장하고 매번 계산하면, 나중에 DB가 수치를 고쳤을 때
과거 기록이 소급해서 바뀐다. 먹은 날의 기록은 그날 값으로 고정되어야 한다.

### 왜 `totals`를 중복 저장하나

캘린더는 한 화면에 30~31일을 그린다. 날마다 slots를 다 읽어 합치면 읽기 횟수가 30배가 된다.
`totals`만 읽도록 쿼리를 구성한다. **쓰기 시점에 갱신하며, 갱신 누락이 곧 버그다** — 테스트로 잠근다.

## 보안 규칙 (배포 전 필수)

```
match /users/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
match /foods/{doc} {
  allow read: if request.auth != null;
  allow write: if false;          // Cloud Functions(Admin SDK)만 쓴다
}
```

익명 인증을 쓰되 **계정 복구 경로를 만든다** — 익명 uid는 앱 삭제 시 사라진다.
나중에 이메일 링크로 승격(`linkWithCredential`)할 수 있게 설계해 둔다.

## Cloud Functions 엔드포인트

| 경로 | 하는 일 |
|---|---|
| `GET /api/foods/search?q=` | 식약처 검색 → 정규화 → `foods/` 캐시에 upsert |
| `GET /api/foods/barcode/:code` | Open Food Facts 조회 → 정규화 → 캐시 |
| `POST /api/roulette/explain` | (선택) solver 결과에 설명 문구. **숫자를 만들지 않는다** |

전부 인증 필요. 익명 uid라도 토큰 검증은 한다 — 안 하면 남이 내 쿼터를 태운다.

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
