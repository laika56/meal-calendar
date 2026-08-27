# NEXT — 세션 시작점

**이 파일이 현재 상태의 단일 출처다.** 다른 곳에 진행 목록을 만들지 않는다.

최종 갱신: 2026-08-27

## 지금 상태

## ✅ dead code 제거·스크립트 중복 통합 — Codex (2026-08-27)

Git 추적 211개 파일·JS/MJS/CJS 120개 정적 감사에서 확인한 범위만 수정한다.
`tests/harness.test.js` 스캐폴드, 미사용 DB export 2건, 미사용 환경변수 예시 2건을
제거했고, 카탈로그 스크립트의 canonical JSON/해시 중복과 서비스워커 리비전
갱신 스크립트 2개를 각각 단일 구현으로 통합했다. Firebase 배포 경계에 필요한
`src/lib/*` ↔ `functions/shared/*` 6쌍은 구조적 중복이므로 그대로 둔다. #코덱스

삭제 전에 각 심볼·환경변수의 추적 소스 참조 0건과 스캐폴드 자체 삭제 지시를
확인했다. 공통 유틸은 RED 3건(`canonicalJson is not a function`)을 먼저 확인한 뒤
기존 바이트 직렬화·SHA-256 동작을 그대로 옮겼다. 상세 근거와 검증 명령은
`docs/PATCH-NOTES-2026-08-27-DEAD-CODE.md`에 분리했다. 배포·실행 중 앱 변경은 없다.

## ✅ 바코드 → 진짜 제품명 (코리안넷) — Claude (2026-08-27, 배포됨)

**「구르농닭 계란」을 막은 것만으로는 부족했다.** 맞는 이름을 찾아오지 않았다.
`8809396600014` 의 등록명은 「(주)마루카네코리아 감동란」이고, 식약처에는
**「감동란 | 주식회사 감동란 | 138kcal/100g」이 있다.** 정보가 없던 게 아니라
**바코드와 이름을 잇는 다리가 없었다** — 식약처 API 는 바코드 조회 경로가 없고
이름으로만 찾는다.

**조회 순서:** mine → 공용 카탈로그 → OFF → **코리안넷** → UPCitemdb.
코리안넷은 서버(`functions/koreannet.js`)에서만 부른다 — 페이지가 `http` 라
HTTPS PWA 에서 직접 부르면 혼합 콘텐츠로 막힌다.

### 실측

**커버리지** — OFF 한국 제품에서 뽑은 실제 880 바코드 **N=300**:
이름 있음 **281(93.7%)** · 빈 페이지 19(6.3%) · 에러 **0** · p50 233ms / p90 313ms.
앱이 이름을 못 주던 36건 중 **31건(86.1%)** 을 메운다.

**그 이름으로 식약처를 쳤을 때** — N=86: 이름이 겹치는 결과 **31(36.0%)** ·
겹치지 않는 결과 **0** · 질의 실패 0 · 0건이거나 너무 넓음 55(64.0%).
나머지 64% 는 **식약처에 그 제품이 없는 것**이다. 그때도 「감동란 50G x 2EA」라는
정확한 이름이 화면에 뜬다 — 아무것도 못 보던 것보다 낫다.

### 넓은 후보 질의를 만들지 않는다

초안은 제품명이 안 걸리면 「마지막 두 토큰」·「제일 긴 토큰」으로 물러났다.
적중률이 34.1% → 77.6% 로 뛰는데 **올라간 43%p 가 전부 오답이었다**:
`삼다수` → 「라면꼰대x제주삼다수 고사롱라면 426kcal」, `참이슬 후레쉬` → 「통밀후레쉬
샌드위치」. **물에 라면 열량을 붙이는 건 아무것도 안 주는 것보다 나쁘다.**

### 잡은 버그 셋

1. **판매자가 「(주)감동란」** 이라 조직명을 지우자 제품명까지 사라졌다 → 비면 되돌린다
2. 그 결과 **빈 질의**가 만들어졌고, 빈 질의로 식약처를 치면 **319,060건이 통째로** 왔다
3. **잰 범위 밖에 적용** — 미국 바코드 `036000291452` 에 코리안넷이 「한얼」을 주고
   그게 UPCitemdb 를 가로챘다. **배포본 실호출로 잡았다.** 이제 880·881 13자리만 묻는다

### 프로덕션 실호출 검증 (익명 토큰)

| 바코드 | 결과 |
|---|---|
| `8809396600014` | `감동란` · koreannet hit |
| `8801043016049` | `짜파게티큰사발` · koreannet hit |
| `036000291452` | koreannet **miss** → UPCitemdb `Shockwave Seats SW01983 Shock Pump` |
| `8809999999994` | HTTP 400 「유효한 바코드가 필요하다」 |

호스팅 바이트 대조 6경로 전부 일치(`/` 포함). **651 tests · 650 pass · 0 fail · 1 skip.**

### ⚠ 저작권 문구 — 조치한 것

페이지에 「무단 수집 및 유통, 거래는 법적 제재를 받을 수 있습니다」가 적혀 있다.
사용자 컨펌 후 배포했고, 노출을 줄이는 쪽으로 짰다:
**스캔 1건당 1회만** 호출 · 목록 훑기·선수집 **없음** · 공용 카탈로그(`foods/`)에
**적재 안 함**(개인 영역 캐시만) · 타임아웃 4초 · 실패는 삼키고 다음 출처로.

> **부수 산출물:** `scripts/bump-shell-revision.mjs`가 `SHELL_REVISION` 계산·갱신의
> 단일 명령이다. `--check`로 수정 없이 어긋남도 검증한다. 실패 출력의 해시를 손으로
> 옮기지 않는다. 계산식이 바뀌면 셸 파일 테스트와 이 명령을 함께 고친다.

## ✅ OFF 가 「틀린 이름」을 줄 때 그걸로 검색하지 않는다 — Claude (2026-08-27, 배포됨)

**증상:** `8809396600014` 스캔 → 「구르농닭 계란」으로 식약처 자동 검색.
**GS1 코리아넷 등록은 「(주)마루카네코리아 감동란」이다.** OFF 레코드는 제3자 앱
(`municorn-calorie-counter-app`)이 올렸고 **사진이 없다** — 아무도 실물 포장과 대조한 적이 없다.

**원인은 전제였다.** 기존 `off-identity` 경로는 「이름은 맞고 영양값만 없다」를 전제로
검색창을 자동 채우고 `requestSubmit()` 까지 했다. **이름 자체가 틀릴 수 있다는 경우를 안 봤다.**

**판정 규칙: 사진 없음 AND `completeness` < 0.30 → 이름을 못 믿는다.**

임계값은 실측 분포에서 나왔다. OFF v2 search `countries_tags=south-korea`,
`page_size=100`, **page 1·2·3·5** (page 4 는 503 4회로 건너뜀). **N=400.**
이 판정을 타는 것(이름 있고 kcal 없음)은 **39건(9.8%)**.

| 후보 규칙 | 39건 중 거부 |
|---|---|
| 사진X 만 | 10 (25.6%) |
| `completeness`<0.30 만 | 18 (46.2%) |
| **사진X AND `completeness`<0.30** | **4 (10.3%)** |

거부된 4건 전량: `정육` · `다보록` ×2 · `콘드로이친`. **전부 제품명이 아니라 분류·브랜드·
성분 이름이고, 검색어로 쓰면 엉뚱한 결과가 나온다. 오탐 0건.**

**신호가 없으면 거부하지 않는다.** `null`/`undefined` 는 「모른다」이지 「나쁘다」가 아니다
(절대규칙 7). `quality` 를 안 넘기는 호출부는 그대로 돈다.

- `src/lib/offParser.js` — `offProductQuality()` 신설. `completeness`·사진 유무만 읽는다
- `src/lib/barcodeProduct.js` — `isTrustedOffIdentity()` 신설, `toBarcodeIdentity` 가 통과시킨다
- `public/app.js` — `lookupOff` 가 `quality` 를 같이 넘긴다
- `public/sw.js` — `SHELL_REVISION` 갱신

**검증:** 631 tests · 630 pass · 0 fail · 1 skip. **변이 3종 전부 잡힘**(가드 제거 / 임계값
0.3→0.1 / 없는 `completeness` 를 0 으로). 실서버 3건: 문제 제품 거부 · 서울우유(사진O·
c=0.4625) 통과 · OFF 미등록(`8801056249052`) 기존 경로 유지.
**배포본 바이트 대조 일치** — `/`·`/public/app.js`·`/public/index.html`·
`/src/lib/{offParser,barcodeProduct}.js`·`/sw.js`.

> **부수 발견 — 「OFF search 503」의 원인이 달랐다.** `offParser.js` 주석에 「2페이지부터
> 503이라 N≥300 못 채웠다」고 적혀 있었는데, 실제 원인은 **User-Agent 에 연락처가 없어서
> 차단된 것**이다. `meal-calendar-quality-probe/1.0 (연락처)` 로 넣으니 400건을 떴다.
> **다음에 OFF 를 대량으로 뜰 때 이 UA 규칙을 먼저 적용한다.**

**남은 것:** 실기기 미확인(위는 전부 Node + 실서버 API). 코리아넷 조회 경로 추가는 별개
작업이고 **무료 공개 API 는 확인 못 했다** — `api.koreannet.or.kr` 서브도메인은 존재한다.

## ✅ 바코드 커버리지 실측 + 내 기록 우선 조회 — Claude (2026-08-26 오후)

「바코드는 읽히는데 정보를 못 찾는다」를 실측했다. **커버리지 문제가 맞고, 원천의 한계다.**

| 원천 | 행 | 바코드 | kcal 보유 |
|---|---|---|---|
| 식품이력추적 `trace` | 98,299 | 98,298 (13자리 **24,150**) | **0** |
| `foodqr-list` | 4,033 | 4,033 | 0 |
| `foodqr-label` | 3,995 | 3,995 | **3,995** (탄단지 0) |
| `foodqr-nutrients` | 43,442 | 43,442 | **4,623** |
| 공용 카탈로그 게시분 | **2,109** | — | — |
| OFF 한국 제품 | **3,189** | — | 표본 10건 중 4건 |

**`trace` 98,299행은 영양성분이 아예 0이다.** 24,150개 바코드에 붙일 열량이 원천에
없어서 버려진 것이지, 조인 로직이 부실했던 게 아니다. 게시 2,109개는 원천 한계에 가깝다.

전체 경로 실측(표본 10건, **OFF 등록 제품에서 뽑아 실사용 분포가 아니다**):
공용 **0/10** · OFF 영양까지 **4/10** · OFF 이름만 **6/10**.

**고친 것 — 내가 확인한 제품을 다시 스캔하면 바로 뜬다.** 조회 순서 맨 앞에
`lookupMine` 을 넣고 `users/{uid}/barcodes/{code}` 에 저장한다. 공용 캐시 `foods/` 가
**아니다** — 「개인 스캔 이력을 학습·저장하지 않는다」는 공유를 막는 규칙이고,
내 기록을 나만 읽는 건 그 대상이 아니다. `firestore.rules` 변경 없음.
배포본 실측: 저장 전 miss → 저장 → 조회 hit, 호출 순서 `['mine']` (공용·OFF 미호출).

**범위 밖으로 남긴 것 — 수동 입력은 아직 캐시되지 않는다.** entry 가 100g당 값이 아니라
`kcal`+`amountG` 만 들고 있어서, 저장하려면 역산해야 하고 그 반올림 오차가 영양값으로
굳는다(절대규칙 2). entry 스키마에 `per100g` 을 남기는 별도 작업이다.
**그래서 「영양성분표 찍어 넣은 제품」은 여전히 다음에 또 miss 난다.**

**`sources.json` 의 기록이 오해를 낳고 있었다.** C005·I2570 이
`temporarily-unavailable-error-503` 으로 박혀 게시에서 빠졌는데, 2026-08-26 15:12 KST
재측정에서 HTTP 200 · 본문 메시지가 「12시~19시에는 서비스가 일시적으로 원활하지
않을수있습니다」였다. **영구 장애가 아니라 시간대 제한일 수 있다.**
`scripts/probe-foodsafety-window.mjs` 를 **19시 이후에** 돌리면 판정된다. 미측정이다.

**남은 확대 경로 (측정 근거 있음)**
1. `trace` 24,150개를 **이름만** 게시 — 영양성분 없이 제품명·제조사만. 영양성분표
   촬영으로 잇는다. 라이선스 `unrestricted`·`publication: approved`
2. `foodqr-label` 3,995개 — kcal·1회제공량만. `partialNutritionEntry.js` 가 이미 있다
3. C005/I2570 재판정 (위)
4. **안 본 것**: GS1 코리아넷 등 상업 DB, `trace` 의 7자리 48,942개·8자리 18,702개의 정체

## ✅ 워크트리 4개 통합 + 배포 정리 — Claude (2026-08-26)

`codex/barcode-wiring`·`adhoc-1`·`adhoc-2`·`cdn-pin` 을 전부 `master` 에 넣었다.
코드 충돌은 0건이고 `docs/NEXT.md` 문서 충돌만 있었다. 549 → **602 tests, 601 pass,
0 fail, 에뮬레이터 전용 1 skip.**

**머지해야만 드러나는 버그를 하나 잡았다.** `adhoc-1` 이 `/src/lib/multiCandidate.js` 를
만들고 `app.js` 가 import 하는데, `sw.js` 와 그 가드 테스트는 `barcode-wiring` 쪽에
있었다. 각 브랜치 단독으로는 둘 다 통과한다. 그대로 배포했으면 오프라인에서 앱이 안 떴다 —
2026-08-14 에 세 파일로 같은 사고가 났던 그 경로다. **브랜치별 green 은 통합 green 이 아니다.**

배포본을 실제로 조회해서 잰 것들:

- `hosting.public` 이 `.` 이고 ignore 가 블랙리스트라, 목록에 없는 것이 전부 나가고 있었다.
  `/data/franchise/public/mfds-franchise.json` **13,039,209B (12.4MB)** 와
  `/package.json`·`/package-lock.json` 이 200 이었다. 브라우저의 `/data/` 참조는 0건이다
  (앱이 쓰는 건 `/src/data/` 로 경로가 다르다). 제거 후 프랜차이즈 검색은 그대로 동작한다 —
  그 데이터는 Firestore 카탈로그에서 오기 때문이다
- 응답 보안 헤더가 HSTS 하나뿐이었다. 카메라를 쓰는 PWA 인데 `Permissions-Policy` 가 없어
  임베드 문맥에서 권한이 열린 채였다. `camera=(self)` 로 스캔은 살리고 나머지는 닫았다
- **CSP 는 일부러 넣지 않았다.** 필요한 출처가 gstatic·jsdelivr·googleapis·openfoodfacts·
  `blob:`·`wasm-unsafe-eval` 로 넓어서 잘못 쓰면 앱이 통째로 죽는다. Report-Only 부터
  시작하는 별도 작업이다
- 발주33 의 CDN 가드에 사각지대가 둘 있었다. jsdelivr·unpkg 만 보고 `.js` 만 읽어서,
  Firebase SDK 가 오는 `www.gstatic.com/firebasejs/<version>/` 과 `index.html` 의
  modulepreload 를 못 봤다. `db.js` 의 import 와 `index.html` 의 preload 가 어긋나면
  브라우저가 SDK 를 두 버전 받는데 화면은 멀쩡하다. 둘 다 가드에 태웠다

**배포본을 브라우저로 직접 눌러 확인했다** (Playwright MCP, 데스크톱):
비회원 시작 → 8/26 → 점심 `+ 추가` → `닭가슴살` 검색(`/api/foods/search` 200, 결과 8건,
할리스 프랜차이즈 포함) → 항목 선택 → 30g → 추가. **116 kcal 이 저장되고 하루 합계와
슬롯에 반영됐다** (388kcal/100g × 30g = 116.4). `serviceWorker.controller` 활성으로
새 셸이 실제로 잡힌 것도 확인했다. 콘솔은 **0 errors, 0 warnings** 다 —
`/favicon.ico` 404 와 `apple-mobile-web-app-capable` deprecated 경고를 이번에 없앴다.

**Playwright 를 devDependency 로 넣지는 않았다.** 위 흐름은 MCP 로 실측했고, npm 의존성
추가는 이 프로젝트의 「의존성 0개」 전제를 바꾸는 결정이라 사용자 판단이 먼저다.
`public/app.js`·`public/db.js` 의 자동 커버리지가 0인 상태는 그대로 남아 있다.

**실기기 확인은 여전히 남아 있다.** 위는 전부 데스크톱 크롬이다.



## ✅ 영양성분표 실시간 카메라 인식 전환 — Codex (2026-08-19)

파일을 먼저 촬영해 올리던 흐름을 바코드처럼 카메라를 연 채 인식하는 흐름으로 바꿨다. 중앙
가이드 안의 프레임이 선명하고 약 0.5초 동안 안정적일 때만 한 프레임을 OCR하며, 양과 열량이
모두 확인되면 기존 수동 확인 폼에 채운다. 불충분하면 카메라를 유지하고 다시 기다린다. `지금
인식`, 사진 불러오기, 직접 입력 경로도 유지하며 카메라 프레임·사진·OCR 원문은 저장하지 않는다.
커밋 `cf5e752`를 비공개 원격 브랜치에 푸시하고 Firebase Hosting에 배포했으며, 운영의 HTML·앱·
OCR·프레임 판정·서비스워커 5개 파일 SHA-256이 로컬과 모두 일치한다. 실제 iPhone의 초점·조도·
Tesseract 한국어 인식 속도 확인만 남아 있다.

## ✅ 입력 신뢰도·반복 기록 6기능 로컬 구현 완료 — Codex (2026-08-19)

사용자 승인 범위는 영양성분표 촬영 입력, UPCitemdb를 포함한 통합 바코드 조회, 음식 기록
수정 이력, 최근 7일 요약, JSON/CSV 내보내기·merge-only 복구, 한 끼/하루 프리셋 강화다.
통합 설계를 `docs/superpowers/specs/2026-08-19-meal-calendar-reliability-and-reuse-design.md`에
고정해 사용자 승인을 받았고, 기능별 실행 계획을 `docs/superpowers/plans/2026-08-19-*.md`로
분리해 TDD로 구현했다. 영양성분표 OCR 확인 입력, 국내 카탈로그→OFF→UPCitemdb 식별 순서,
항목 수정 이력, 최근 7일 요약, 엄격 검증 JSON/열람용 CSV와 merge-only 복구, 한 끼·하루
프리셋을 앱 셸과 Firestore 경계에 연결했다. 복구는 하위 record의 예상 밖 필드와 비정상 숫자를
쓰기 전에 거부하며, UPCitemdb 식별값은 영양값으로 자동 승격하지 않는다.

집중 테스트 57/57, 보강 후 관련 테스트 11/11, 전체 `npm test` 545개 중 544 pass·0 fail·
에뮬레이터 전용 1 skip이다. 변경 JS 문법·서비스워커 셸 경로/bytes digest·diff whitespace도
검증했다. 390×844 로컬 브라우저에서 첫 화면 레이아웃을 확인했으나 인증 뒤 여섯 흐름과 카메라·
OCR·다운로드는 실제 iPhone에서 확인하지 않았고, 운영 배포도 하지 않았다. 기존
`public/app.js`, `public/index.html`, `public/sw.js`의 로딩 스켈레톤 미커밋 변경은 다른 작업
소유이므로 그대로 보존했다.

## ✅ 공용 국내 바코드 카탈로그 1차 운영 반영 (2026-08-19)

개인 스캔 이력을 학습하거나 저장하지 않고, 식약처 FoodQR 전체 공개 데이터에서 검증된
바코드만 공용 Firestore 카탈로그로 게시했다. 스캔은 공용 카탈로그를 먼저 조회하고 miss나
장애일 때 기존 Open Food Facts를 조회한다. 두 곳에 없으면 값을 만들지 않고 수동 입력으로 간다.

- 원본 전수 측정: FoodQR 목록 4,033 / 표시 3,995 / 영양 43,442행,
  식품이력추적 98,299행, 통합영양성분 319,060행
- 게시: FoodQR 415 + 정확 품목보고번호 조인 1,694 = 총 2,109개, material SHA-256
  `60609134883ac1a12778f856db77a907dffa5eb6efe6be52d1938252c023ef9d`
- Firestore: ready run 2,109개와 실제 collection 2,109개 일치, payload SHA-256
  `10b9e342daa7a8de7409b3bd0fdede59ac5f341967bc1dc7ba70ac164878b250`
- 배포: `barcodeFood`(서울), Firestore deny rules, Hosting 완료
- 운영 검증: 인증 hit 200, `8801392194078`은 공용 카탈로그와 OFF 모두 정직한 miss,
  인증 사용자의 카탈로그 직접 read는 403
- 전체 자동 검증: 514 tests 중 513 pass, 0 fail, emulator 전용 1 skip;
  별도 공식 임시 JRE 에뮬레이터 실행 2/2 pass

식품안전나라 C005/I2570은 측정 당시 `ERROR-503`이라 이번 게시에서 제외했다. 키를 앱이나
저장소에 넣지 않았고, 서비스가 정상화되면 동일한 전체 측정·검증 절차로 추가한다. 실기기에서
알려진 2,109개 중 하나의 실제 포장을 스캔하는 확인은 남아 있다.

## ✅ 프랜차이즈 카탈로그 운영 반영 완료 (2026-08-19)

식약처 프랜차이즈 원자료 319,060건을 전수 확인해 공개 가능한 16,341건을 게시했다.
제조사명이 비어 브랜드를 검증할 수 없는 2,289건은 추정하지 않고 제외했다. 검토한
써브웨이 공식 메뉴 1건을 합친 검색 대상은 총 16,342건, 브랜드는 126개다.

- 공개 스냅샷 SHA-256: `1f4e4b92282b44a8144b1e4d4ce5a6eea1c6e5f46089bfbb2fcf44c46c75f2a7`
- 카탈로그 SHA-256: `09a79cad7adab610df3a0f36e057856623ca6f84bf0299b16c02fda427727fbe`
- Firestore import: dry-run 16,471 writes와 apply 16,471 writes 일치, current run `ready`
- 배포: Firestore rules, `searchFoods`, Hosting 완료 — `https://calorie-43692.web.app`
- 운영 검색: 두 표기(`써브웨이`, `서브웨이`)가 같은 `catalog_subway-menu-1528`을 반환한다.
  이탈리안 비엠티는 공식 1인분 228g, 388kcal, 단백질 21g이며 탄수화물·지방은 null이다.
- 운영 보안: 인증 사용자의 카탈로그 직접 read/write는 모두 403, 검색 Function만 접근한다.
- 최종 자동 검증: 447 tests 중 446 pass, 0 fail, Firestore emulator 전용 1 skip.

실제 배포 브라우저에서 `써브웨이 · 공식값 · 1인분 228g · 388kcal`과 출처 링크를
확인했다. 탄수화물·지방이 없는 공식 항목은 자동 저장되지 않고 두 입력칸을 비운 수동
확인 화면으로 이동하며, 그 시점에도 하루 합계는 0kcal였다.

첫 배포 직후에는 서비스워커의 구형 셸 캐시가 새 렌더러를 가려 `100g당 170kcal`로
보였다. `SHELL_REVISION`을 셸 파일 전체의 SHA-256에 결속하고 테스트로 잠근 뒤 Hosting을
재배포해 해결했다. 앞으로 셸 파일을 바꾸면서 revision을 갱신하지 않으면 테스트가 실패한다.

**남은 실기기 확인:** iPhone standalone PWA에서 첫 실행 후 공식값 표시·부분 영양 수동
입력·광범위 검색 차단·바코드 카메라 권한/포커스를 확인해야 한다. 데스크톱 배포 브라우저와
API 검증은 완료됐지만 이 항목들을 iPhone에서 확인했다고 쓰면 안 된다.

## 🎨 확정 화면 리디자인 구현 중 — Codex 이관 (2026-08-15)

Claude가 정리한 리디자인 결정을 Codex가 이어받아 구현 중이다. 프레임워크 전환은
확정되지 않았으므로 현재 바닐라 HTML/CSS/JS 구조를 유지하고, 확정된 화면만 바꾼다.

**현재 구현:** 딥그린 고정 다크 토큰, 캘린더 미니 링과 월 4칸 요약, 일간 반원
칼로리 게이지와 탄·단·지·체중 4칸 카드, 밀도 높은 끼니 목록, 항목 추가의 브랜드
0건 안내·1인분/참고값 구분·그릇 단위 선택·자주 먹는 것/한 끼 프리셋을 앱에 연결했다.
2026-08-15 실기기 캡처에서 상세 시트 뒤 달력 날짜가 비치는 stacking bug를 발견해
`.sheet`를 달력 날짜보다 높은 명시적 레이어로 고정하고 회귀 테스트를 추가했다.
후속 실기기 캡처에서 미니링 진행률이 링 자체의 `--ring-progress: 0`에 덮이는 문제와
음식명 길이에 따라 kcal 열이 흔들리는 문제를 확인했다. 링은 날짜 버튼의 실제 진행률을
상속하고, 상세 항목은 `음식명 | 우측 정렬 kcal | 삭제` 고정 3열로 바꿔 테스트로 잠갔다.
실기기에는 이전 `.day-ring { --ring-progress: 0 }` CSS가 남아 부모 버튼의 진행률을 계속
덮는 경우가 확인됐다. 진행률을 실제 링 요소에 인라인으로 적용해 구·신 CSS 모두에서 우선하게
하고 서비스워커 캐시를 v7로 올렸다. 배포 후 실기기 재확인이 필요하다.
오늘 체중 입력은 iPhone Safari의 포커스 자동 확대 기준보다 작던 `12px`를 `16px`로 올리고
회귀 테스트로 잠갔다. 전체 `node --test` 316/316 통과했으며 실기기 재확인이 필요하다.
Firebase Hosting 로컬
에뮬레이터의 310×620 뷰에서 42개 달력 셀·4개 요약 카드·가로 넘침 없음과 콘솔 오류 0을 확인했다.

**확정된 것 (일간 상세 화면):**
- 기반: 딥그린(`#37d67a`) 다크 대시보드, 반원 게이지(`conic-gradient`/SVG arc), 4칸 매크로 카드
- 체중 칸 = 매크로 4번째 칸, **가입일 대비**(`시작` 대신 실제 날짜 `08.14` 표기),
  칸을 누르면 기준일 변경 가능(단, **체중 기록이 있는 날짜만** 기준으로 선택 가능)
  → 구현 시 주의: 가입 시 기입 체중이 프로필 값과 날짜별 기록(`days.weightKg`)이
  다른 자리에 저장돼서, 가입일을 기준일로 쓰려면 가입 처리에서 그 값을 날짜별
  기록으로도 같이 써야 한다. **아직 설계만, 미구현.**
- 리스트: 슬롯(끼니) 헤더를 굵은 밑줄로 구분, 메뉴는 흐린 회색 — 항목이 여러 개
  쌓여도(하루 8개+) 스크롤 없이 읽히는 밀도로 확정
- 첫 기록일 때 `0kg`/`▼0.0` 금지 — "시작 기록"으로 표시(절대규칙 7과 동일 원칙)

**확정된 것 (캘린더 화면):** 미니 링(칸마다 conic-gradient) + 상단 4칸 요약(평균·기록일수·
적정일수·체중). 오늘 표시는 색이 아니라 테두리(달성색과 안 싸우게).

**항목추가·검색:** A5(그릇 단위 양 선택)+A6(브랜드 없을 때 1탭 저장 안내)+
A8(쉼표로 여러 개 한번에) 통합 목업은 `docs/mockups/add-flow.html`에 있다.
현재 앱 연결은 브랜드 0건 안내, 그릇 선택, 검색 결과의 1인분/참고값 표시,
자주 먹는 것/한 끼 프리셋까지다.

**2026-08-18 추가 — 다중입력 사전확인(화면3) + 추가직후 완료(화면5) 구현·배포함.**
쉼표 다중 입력은 이제 즉시 저장하지 않고 `#multiConfirm` 패널에서 조각별
확인됨/추정/못알아들음을 먼저 보여준 뒤 "N개 모두 추가"를 눌러야 저장된다
(`resolveMultiPieces`가 저장 없이 미리보기만 계산 — `runMultiQuickInput`은
resolve/render/commit 3단계로 쪼갰다). 단일 검색 추가도 `addSearchedFood`
성공 시 바로 안 닫고 `#addSuccess`(화면5)로 kcal·양을 보여주고 "양 고치기"
(방금 넣은 걸 지우고 이름을 프리필해 다시 입력)·"완료" 중 고르게 한다.
`node --test` 316/316 통과, hosting 배포 완료(`calorie-43692.web.app`).
**실기기 확인 못 함 — 배포 직후 식약처 검색 API(`searchFoods` Cloud Function)가
계속 "식약처 API 호출에 실패했다"로 죽어 있었다.** 다중입력 화면 자체(못 알아들음
표시·버튼 비활성화·뒤로가기)는 브라우저로 확인했지만, 성공 경로(확인됨/추정 배지,
추가직후 화면, 양 고치기)는 API가 살아난 뒤 실기기로 다시 확인해야 한다.
검색이 원래 이 정도로 죽어있었는지, 오늘 새로 죽은 건지도 미확인 — 이 항목과
별개로 원인을 봐야 한다.

**아직 안 만든 화면:** 설정. 로그인/가입 화면.

**React 전환 여부는 여전히 미결정.** 이번 이관에서는 바꾸지 않았다. 설정과
로그인/가입 화면도 디자인 미확정이라 기존 화면을 유지한다.

## 🐛 라멘 89kcal — 진짜 원인 찾음: 서비스워커 캐시 (2026-08-14 밤)

발주22(파서)·26(참고값 표) 둘 다 코드는 배포돼 있었는데(`curl` 로 200 확인)
**사용자 폰에는 옛 화면이 계속 떴다.** 원인: `public/sw.js`의 `SHELL_FILES`
목록에 오늘 추가한 `roulette.js`·`servingEstimate.js`·`weightTrend.js`가
빠져 있었다 — 서비스워커가 옛 조합을 캐시로 계속 서빙. **오프라인에서는
앱이 아예 안 떴을 것**(온라인에선 멀쩡해 보여 아무도 몰랐음).

고침: 목록 보강 + `CACHE_NAME` v4→v5. 주석("빠뜨리지 마라")이 실제로
안 지켜졌던 전례가 있어서, 이번엔 **테스트로 잠갔다** —
`tests/shellFiles.test.js`가 `app.js`/`db.js`의 실제 import를 파싱해
목록과 대조. 일부러 하나 빼서 테스트가 진짜 잡는지 확인함. 배포 완료.

**근본 원인 분석은 `docs/WHY-RAMEN.md`에.** 라멘을 하루 4번 반복해서 들은 이유
5가지 — 다음에 비슷한 "고쳤다는데 안 고쳐졌다" 패턴이 나오면 먼저 읽을 것.

## ✅ 이메일 인증 반영 버그 — 고침 (2026-08-14 밤)

증상(사용자 제보): 메일 링크로 인증하면 파이어베이스 페이지는 성공이라 하는데
앱에서는 「⚠ 이메일 미인증」이 안 사라지고, 재발송을 누르면 "시도가 너무 많습니다".
앱을 껐다 켜야 반영됐다.

**원인:** `observeAuth` 가 `onIdTokenChanged` 라 **토큰이 바뀔 때만** 불린다.
그런데 인증 메일 링크는 **다른 브라우저 컨텍스트**(PWA 가 아니라 사파리)에서 열린다.
거기서 인증이 끝나도 앱 쪽 토큰은 그대로라 콜백이 영영 안 불렸다.

**재발송 버튼 문제도 같은 원인이었다.** 그 버튼은 `emailVerified` 로 숨기는데 값이
낡아서 계속 보였고, 이미 인증된 사람이 눌러 `auth/too-many-requests` 를 맞았다.

**고친 방법:** `db.refreshVerification()` 신규 — 서버에서 사용자를 다시 읽는다
(`user.reload()`). 앱이 **포그라운드로 돌아온 순간에만 한 번** 부른다
(`visibilitychange`). 사용자가 메일에서 돌아오는 경로가 정확히 이것이다.
**폴링하지 않는다** — 주기적으로 두드리면 `too-many-requests` 를 더 만든다.
할 일이 없으면(비로그인·익명·이미 인증됨) 네트워크를 안 탄다.

**실측한 것:** 핸들러 등록·발화, 익명 사용자에서 네트워크 요청 0건, 콘솔 에러 없음.
**실측 못 한 것:** 「미인증 → 메일 링크 클릭 → 앱 복귀 → 경고 사라짐」 전체 흐름.
계정 생성·비밀번호 입력이 필요한데 Claude 가 할 수 없는 행동이다.
**사용자가 실제 계정으로 확인해야 완결된다.**

**룰렛 후보를 검색 캐시 전체로 넓힘, 실측 확인 (2026-08-14).** 발주23·25로 만든
`buildCachedFoodCandidates`·`capCandidatePoolSize`를 `app.js`/`db.js`에 배선함
— `db.loadCachedFoods()`가 `foods/` 컬렉션(최근 200건)을 읽어 프리셋·최근항목과
합친다. 배선 중 "김밥 undefinedg" 표시 버그를 발견해 고침(entries에 `amountG`
누락 — Firestore 저장 시 undefined 거부 함정과 같은 종류). 로컬+실서버 양쪽
브라우저로 직접 눌러서 정상 표시 확인, 배포 완료.

**iOS 실기기 확인 — 사용자 실측 통과 (2026-08-14).** `docs/IOS-AUTH-CHECK.md`
체크리스트 전 항목 확인함(구두 확인, 항목별 세부 기록은 없음).

**Phase 5 완료 — 체중 + 추이 (2026-08-14). v1 완성.**
일간 상세에 체중 입력 한 칸(입력 멎고 800ms + blur 시 저장), 캘린더 상단에 추세 요약.
`weightTrend.js`(발주14)의 이동평균·주당변화(최소제곱 기울기)·방향 판정을 그대로 쓴다.
**표본이 1개면 「변화 없음」이라고 하지 않고 「다른 날짜에도 기록이 필요하다」고 말한다** —
`direction: 'unknown'` 을 0 으로 뭉개면 화면이 거짓말한다(절대규칙 7).
배포본 실측: 1개→안내문구, 2개→`▼ 주당 -3.5kg (2일 · 2회 기록)`, 새로고침 후 유지.

**검색 대개조 완료 (2026-08-14).** 검색어를 통째로 던지던 것을 질의 계획 순회로 바꿨다.
`서가원 김밥`(0건)→4차 시도 `김밥` 20건, `맥도날드 빅맥`(0건)→2차 시도로 빅맥 223g.
1인분을 아는 식품은 「½개/1개/1½개/2개」 칩으로 받는다 — 그램수를 안 친다.
실측: 빅맥 1개 = 223g = 582kcal, 캘린더 반영까지 확인.

**자연어 빠른 기록 구현 완료, 로컬 실측 완료 (2026-08-13, 아직 미배포).**
`반숙란 2개` 입력 한 번으로 식약처의 `반숙란` 결과를 자동 선택하고, 식약처 가이드의 달걀 1개
50g 대표 중량을 적용해 2개분 칼로리·탄단지를 기록했다. 목록에는 `2개 · 추정`과 근거가 남고,
새로고침 뒤에도 유지됨을 확인했다. `밥 반 공기`(질병관리청 1공기 200g)와 명시적 g도 지원한다.
대표 중량이 없는 `닭가슴살 한 팩`은 임의 계산하지 않고 기존 검색 결과로 내려간다.
순수 파서·선택 로직 포함 전체 테스트 **108/108 통과**. 커밋·배포 완료.

**비회원→회원 계정 복구 완료 (2026-08-13). 커밋 `7b2ac65` + `e03febb`, 배포 완료.**

「비회원(익명) / 회원(이메일+비밀번호)」 두 갈래. 승격은 `linkWithCredential` 이라
**uid 가 유지되므로 Firestore 데이터 이동이 0이고 보안 규칙도 안 고쳤다.**
게이트 화면, 가입·로그인·로그아웃, 미인증 경고 상주, 비밀번호 재설정, 중복 이메일 충돌 처리.
설계 전문 `docs/superpowers/specs/2026-08-13-auth-guest-member-design.md`.

**설계 도중 뒤집은 전제:** `ARCHITECTURE.md` 의 "이메일 **링크**로 승격"은 iOS standalone PWA
에서 성립하지 않는다 — 메일의 링크를 탭하면 PWA 가 아니라 Safari 가 열리고, 둘은 저장소
컨텍스트가 분리돼 있어 승격시킬 익명 uid 자체가 없다. → 이메일+비밀번호로 확정.

**구현 중 실측으로 잡은 것:** `onAuthStateChanged` 는 링크 성공 후 안 불린다(uid 가 안 바뀌므로).
→ `onIdTokenChanged` 로 교체.

**최종 리뷰(Opus)가 잡은 Critical 2건 — `e03febb` 로 수정:**
1. **C1** 「기록 포기하고 그 계정으로 로그인」이 `signOutUser()` 를 **먼저** 불렀다. 익명 uid 는
   그 순간 영구 소멸하는데 이어지는 로그인은 **가입 폼에 방금 지어낸 비밀번호**를 쓴다 —
   실패하면 기록도 없고 로그인도 안 된 상태가 된다. 사전 로그아웃을 제거했다
   (익명 세션 위에서 `signInWithEmailAndPassword` 를 바로 부를 수 있다)
2. **C2** `#upgradeError` 가 `#accountGuest` 안에 있어 회원 상태에선 항상 숨겨졌다 —
   재발송·로그아웃 결과가 100% 안 보였다. 회원 전용 알림 요소를 따로 뒀다

**배포본 실측 (데스크톱 Chrome, `https://calorie-43692.web.app`):** 비회원에 로그아웃 버튼 없음 /
승격 시 uid 보존 / 미인증 경고 상주 / C2 메시지 가시성 / 게이트가 새 세션에만 등장 /
충돌 문구의 「1일치」 실제 숫자 / **C1 — 틀린 비번으로 실행해도 uid·익명세션·기록 200kcal 전부
보존되고 에러가 표시됨** / 맞는 비번이면 계정 전환되며 day13 이 200→100kcal 로 재조회(uid 키
래치 동작 확인). 전체 테스트 **111/111**.

**미검증 (사실로 쓰지 말 것):** ① **iOS 실기기** — 위 실측은 데스크톱 Chrome 이다.
iCloud 키체인 저장 제안과 standalone PWA 동작은 확인 안 됨 ② 인증 메일 링크 클릭
(수신 주소 없음) ③ 계정 전환 시 Firestore 오프라인 캐시에 이전 uid 데이터가 남는지.

**정리 필요:** 시험용 계정 `c1test-a@example.com` 과 버려진 익명 계정 2개가 Firebase Auth 에
남아 있다 — 콘솔에서 사용자가 지운다.

**Phase 7 완료 — 식약처 검색 (2026-08-13, 로드맵 순서보다 앞당김, 사용자 요청).**
Firebase **Blaze 업그레이드**(사용자가 직접 카드 등록, 예산알림 $5) → Cloud Functions
`searchFoods` 배포 → 항목 추가 화면에 "식약처 검색" 탭 → 검색결과 탭 → 양(g) 입력 →
자동계산 미리보기 → 추가. `foods/` 캐시에도 upsert됨. 브라우저로 전체 흐름 실측 확인
(150g 기준 122×1.5=183kcal 등 계산 정확도까지 검산).

배포 중 실측으로 잡은 버그 2개 (둘 다 `docs/ARCHITECTURE.md` 「searchFoods 구현 메모」):
1. **서비스키 이중 인코딩** — `URLSearchParams.set()`이 이미 인코딩된 키를 또 인코딩해서
   MFDS가 "등록되지 않은 서비스키"로 거부함. `decodeURIComponent`로 먼저 풀고 넣게 고침
2. **`mfdsParser.js`의 명세 버그** — `body.items`가 `{item:[...]}`가 아니라 배열 자체로
   오는 케이스를 발주04가 못 봤었다. 발주07로 원본 고침(Codex), Functions 쪽 복사본도 동기화

**Phase 4 완료 — 입력 속도 (2026-08-13).**
프리셋(1탭 추가 + 삭제), 최근 항목(자동 갱신, 최신순 10개), 어제 복사, 수동입력비율 카운터
(`DECISIONS.md` 2번의 되돌리는 조건 — 30% 넘으면 세팅 화면에 경고 뜸). 전부 브라우저로 실측 확인.

또 잡은 버그: `db.js`가 Firebase SDK를 정적 import 해서 **첫 화면이 몇 초씩 빈 채로 있었다**
(ES 모듈은 import 그래프 전체가 로드돼야 실행되므로, 네트워크가 필요 없는 캘린더 그리드조차
Firebase CDN 로딩을 기다렸다). 동적 import로 분리해서 그리드는 즉시, Firebase는 뒤따라 붙게 고침.

**Phase 3 완료 (2026-08-13).**
익명 로그인 → 목표 저장 → 날짜 탭 → 슬롯별 `+ 추가` → 수동 입력 → Firestore 저장 →
새로고침해도 남아 있음. 보안 규칙 배포·실측 완료 (`docs/ARCHITECTURE.md` 「보안 규칙」).

---

**Phase 1(셸+캘린더) + Phase 2(계산엔진 연결) 완료 (2026-08-13).**
`https://calorie-43692.web.app` — 실기기(아이폰) 확인 완료. 데스크톱 반응형 레이아웃도 추가함
(유저 요청 — 원래 iOS PWA 전제였지만 데스크톱 브라우저에서도 쓰게 됨, `#app`/`.sheet-inner`가
`display:contents`로 폰에선 개입 안 하고 `min-width:820px`부터 카드형으로 바뀜).

⚙ 버튼으로 목표 설정(키/체중/생년/성별/운동횟수/목적) → `buildGoalProfile()` 계산 → 결과 표시 →
localStorage 저장(`meal-calendar:profile-v1`) → 캘린더 목표칼로리가 실제 계산값으로 바뀜.
**Firestore 연동 전이라 localStorage가 임시 저장소다 — Phase 3에서 Firestore로 옮긴다.**
캘린더 숫자 자체는 여전히 더미(날짜 시드 해시)다, 목표값만 실계산.

> **작업 순서 규칙:** Codex에 넘길 수 있는 것부터 먼저 발주한다 (`../AGENTS.md` 「순서」).
> Codex가 도는 동안 Claude가 자기 몫을 병렬로 한다.

## 막힌 것 (블로커)

| # | 막힌 것 | 푸는 사람 | 왜 이게 먼저인가 |
|---|---|---|---|
| ~~1~~ | ~~Firebase 프로젝트 생성 + 웹 앱 등록 + Hosting 배포~~ | ~~사용자~~ | **해소 (2026-08-13).** 프로젝트 `calorie-43692`, Firestore(서울, 프로덕션모드=기본거부), 익명인증, 웹앱 등록, Hosting 배포까지 전부 함. 설정값 `src/firebaseConfig.js`, 배포설정 `firebase.json`/`.firebaserc`(둘 다 gitignore됨). **URL: https://calorie-43692.web.app** (HTTPS 확인됨, curl 200) |
| ~~2~~ | ~~실기기 iOS 확인~~ | ~~사용자~~ | **해소 (2026-08-13, 실기기 실측).** standalone/safe-area(20px)/100dvh/HTTPS/SW/저장소영속성 전부 정상. `BarcodeDetector` 없음(예상대로). **카메라 권한은 앱 재실행마다 다시 물어봄 — iOS standalone PWA가 권한을 유지하지 않는다.** 종료→홈화면재실행→재확인까지 실측 완료 |
| ~~3~~ | ~~식약처 API 키~~ | ~~사용자~~ | **해소 (2026-08-13).** 개발계정 자동승인 — 문서의 "승인대기 기니" 가정이 틀렸었다. `.env`에 키 있음(커밋 안 됨). 실측 응답 6건 `tests/fixtures/mfds-sample.json`, 필드매핑은 공식 xlsx로 검증 → `docs/orders/04-mfds-parser.md` 발주함 |

> **순서 주의 — 2는 1에 매달려 있다.**
> iOS Safari는 `getUserMedia`에 HTTPS를 요구한다. 맥에서 `http://192.168.x.x`로 띄워 폰으로 열면
> 카메라가 막힌다 (`localhost` 예외는 폰 자신의 localhost만 해당).
> **Firebase Hosting이 HTTPS를 주고 나서야 카메라 검증이 성립한다.**
>
> 3은 나머지와 독립이고 승인 대기가 있다 → **제일 먼저 신청만 걸어두고 잊는다.**

## 다음 작업

**Phase 1에서 실제로 잡은 버그 3개** (배포는 매번 성공했는데 브라우저에서 안 바뀐 것처럼 보이던 것들.
전부 `docs/ARCHITECTURE.md` 「서비스워커 스코프」에 근거 정리):
1. SW를 `/public/sw.js`로 등록해서 스코프가 `/public/`로 좁아짐 (루트 페이지를 SW가 못 건드림)
2. SW가 cache-first라 재배포해도 브라우저가 헌 버전을 계속 씀
3. `app.js`/`.html`에 `max-age=3600` 캐시헤더가 붙어서 SW를 고쳐도 브라우저 HTTP 캐시가 안 풀림

> **테스트 시 참고:** 위 3개를 고친 뒤에도 claude-in-chrome으로 반복 배포·테스트하는 동안 같은
> 탭에서 헌 버전이 계속 보이는 경우가 있었다 — 브라우저 자체 디스크 캐시가 SW/HTTP헤더 정책이
> 바뀌기 *전에* 캐싱해둔 응답을 규정과 무관하게 들고 있는 경우다. `cmd+shift+r`(하드 리로드)로
> 해결됨. **실사용자는 안 겪는다** — 첫 방문은 항상 새 캐시라서. 이 세션 반복배포 특유의 함정이다.

**Phase 3에서 한 것 (전부 완료·실측):**
1. ~~Firestore 스키마 + 오프라인 퍼시스턴스~~ — `public/db.js`. `persistentLocalCache`를
   `initializeFirestore` 시점에 넘긴다 (구버전 `enableIndexedDbPersistence()`는 deprecated이고
   `getFirestore()` 뒤엔 이미 시작된 인스턴스라 실패한다)
2. ~~보안 규칙~~ — `firestore.rules` 배포·실측 완료
3. ~~익명 인증~~ — localStorage 프로필은 **1회 자동 이관** 후 삭제 (`migrateLegacyProfile`)
4. ~~수동 입력 폼 + 슬롯 4개~~ — 슬롯별 `+ 추가`, 항목별 `×` 삭제
5. ~~`totals` 갱신~~ — `calcDayTotals`(발주06)로 매 저장마다 재계산. 화면 먼저 갱신하고
   저장은 뒤따르며, **실패하면 "저장 실패" 문구를 띄운다** (절대규칙 6 — 조용히 삼키지 않는다)

**Phase 4에서 한 것 (전부 완료·실측, 2026-08-13):**
1. ~~최근 항목~~ — `users/{uid}.recentEntries` 배열, 이름 기준 dedupe·최신순·최대10개.
   빈도 정렬은 안 함(단순 최근순으로 충분해 Codex 발주 안 함 — 별도 컬렉션·쿼리도 안 씀,
   문서 하나에 배열이 훨씬 싸다)
2. ~~프리셋~~ — `users/{uid}/presets/{id}`. 추가 시 폼에 "프리셋으로 저장" 체크박스, 칩 탭으로
   1탭 추가·삭제
3. ~~어제 복사~~ — 전날 슬롯 전체를 현재 날짜에 **추가**(덮어쓰지 않음) — 이미 뭔가 넣었으면
   더해진다
4. ~~수동 입력 비율 카운터~~ — 세팅 화면에 이번 달 기준 표시. **3개월 전체가 아니라 로드된
   달만** — 매번 전체 스캔은 비싸다. 판정(30% 초과 시 Phase7 앞당길지)은 사람이 추이 보고 결정

**다음 — 사용자 결정 대기:** 유저가 "식약처 검색으로 자동계산"을 요청했다가, 그건 Phase 7이고
**Cloud Functions + Firebase Blaze(종량제) 업그레이드가 필요**하다고 설명하니 로드맵 순서대로
Phase 4부터 하자고 함. **Phase 4 끝났으니 Phase 7(식약처 검색) 진행할지 다시 물어야 한다.**
Blaze는 카드 등록 필요(개인 사용량은 사실상 무료) — 과금 관련이라 사용자 확인 필수.

**Phase 8 구현 완료 (2026-08-18):** `바코드 스캔` 탭 뒤에만 zxing-wasm reader를 로드하고,
EAN/UPC 판독 → Open Food Facts 조회 → 기존 양 입력 화면으로 연결했다. 제품/영양정보가 없거나
카메라를 못 쓰면 이름을 가능한 만큼 유지한 채 수동 입력으로 돌아간다. 남은 것은 아이폰
standalone에서 실제 포장 바코드 판독 속도·초점·권한 재요청을 확인하는 물리 기기 실측이다.

## 작업 분담 현황

넘기기 전에 여기 적는다. 같은 파일을 둘이 동시에 잡지 않는다.

| 대상 | 잡은 쪽 | 상태 |
|---|---|---|
| `public/app.js`, `src/lib/multiCandidate.js`, `tests/multiCandidate.test.js` 다중입력 후보 판정 추출 | **Codex** | **완료·커밋 (2026-08-21)** — `orders/31`, 기존 동작 그대로 순수 함수 추출. 타깃 14/14, 전체 563개 중 560 pass·예상된 서비스워커 2 fail·에뮬레이터 1 skip |
| `src/lib/pinnedDeps.js`, `tests/pinnedDeps.test.js` CDN 고정 버전 가드 | **Codex** | **완료 (2026-08-21)** — 발주33. 타깃 12/12, 전체 560 pass·0 fail·1 skip. `tesseract.js@7` 변조 시 `unpinned`/`version: 7`로 실패 후 원복 확인 |
| 공용 국내 바코드 카탈로그(C005/I2570·식품이력추적·FoodQR) | **Codex** | **설계 명세 작성·사용자 검토 대기 (2026-08-19)** — 개인 학습 DB 없이 벌크 공용 카탈로그 우선 + OFF fallback. 인증키 비저장, 실데이터 분포·license gate 후 TDD |
| `src/lib/barcodeProduct.js`, `tests/barcodeProduct.test.js` 체크디지트 검증 배선 | **Codex** | **완료·Claude 검수통과 (2026-08-19)** — 타깃 14/14, Claude 독립 검산 15/15. Codex 가 `SHELL_REVISION` 갱신 필요를 정확히 짚고 `public/` 금지를 지켜 멈췄다(계약대로 동작). 발주서가 그 항목을 빠뜨린 게 원인이라 **Claude 가 `public/sw.js` 의 `SHELL_REVISION` 을 재계산해 갱신**했고 전체 453 중 452 pass·0 fail·1 skip(에뮬레이터) |
| `scripts/build-mfds-franchise-data.mjs`, `tests/franchiseCatalogData.test.js`, Task 3 report | **Codex** | **완료 (2026-08-18)** — Task 3 review-fix round 4/5, 실패 시 독립 old/new 복구본 무조건 보존·경로 보고. focused 22/22, 전체 373/373, validator 통과 |
| `src/lib/offParser.js`, `tests/offParser.test.js` | **Codex** | **완료·Claude 검수통과(2026-08-18)** — 명세 11개 케이스 전부 매칭, 직접 재실행 확인. 사용자 컨펌 대기 → `orders/28` |
| `src/lib/metabolism.js`, `src/lib/units.js` + 테스트 | **Codex** | **완료·커밋** (`meal-calendar` `0a1cf7c`) → `orders/01`, `orders/03` |
| `src/lib/mfdsParser.js`, `tests/mfdsParser.test.js` | **Codex** | **완료·커밋** (`07cff69`) → `orders/04` |
| `src/lib/mfdsParser.js`, `tests/mfdsParser.test.js` 배열형 `items` 대응 | **Codex** | **완료·커밋** (`c288781`) — 82/82 → `orders/07` |
| `src/lib/calendarGrid.js`, `tests/calendarGrid.test.js` | **Codex** | **완료·커밋** (`e84a8b4`) → `orders/05` |
| `src/lib/dayTotals.js`, `tests/dayTotals.test.js` | **Codex** | **완료·리뷰통과** — 77/77, 구현 깨뜨려 테스트 진위 확인함 → `orders/06` |
| `src/lib/authValidation.js`, `src/lib/authMessages.js` + 테스트 | **Codex** | 재검증 완료 (2026-08-13) — `orders/08` 표 전항목 대조, 전체 111/111 통과 |
| `public/db.js`, `public/index.html`, `public/app.js` 인증 흐름 | **Codex** (사용자 역할 제한 해제) | 구현 완료 · 실제 Firebase 실측·Hosting 배포·커밋 완료 |
| 자연어 빠른 기록 (`반숙란 2개`) 파서·UI·테스트 | **Codex** (사용자 편의 우선 설계 승인) | 구현·로컬 실측·커밋 완료 — 108/108, 아직 미배포 |
| `src/lib/searchPlan.js` + 테스트 | **Codex** | **완료·리뷰통과** — 127/127, 미커밋 → `orders/09` |
| `src/lib/mfdsParser.js` 기준단위·쉼표·1회분 의미 교정 + 테스트 | **Codex** | **완료·Claude 검수대기** — 144/144 → `orders/10`. `100mL` 기준·엄격한 천단위 쉼표·총량/1회분 분리·`resolveServing` 반영 |
| `src/lib/mfdsParser.js` 자유 텍스트 수량 보존 + 테스트 | **Codex** | **완료·Claude 검수대기** — 145/145 → `orders/11`. 파싱 불가 문자열은 원문 note로 보존, 비문자열만 `TypeError` |
| `src/lib/mfdsParser.js` 식품군 기준 1회분 판정 + 테스트 | **Codex** | **구현·단위검증 완료, 실데이터 검증 막힘** — 151/151. `verify-mfds.mjs`는 실행 환경 네트워크 차단으로 `fetch failed` → `orders/12` |
| `src/lib/searchResults.js`, `tests/searchResults.test.js` | **Codex** | **완료·Claude 검수대기** — 169/169. 병합·중복제거·안정 순위 구현. `verify-mfds.mjs`는 DNS 차단(`ENOTFOUND apis.data.go.kr`)으로 판정 불가 → `orders/13` |
| `src/lib/weightTrend.js`, `tests/weightTrend.test.js` | **Codex** | **완료·Claude 검수대기** — 203/203. `verify-mfds.mjs`는 외부 요청 단계에서 `fetch failed` → `orders/14` |
| `scripts/check-shared-sync.mjs`, `tests/sharedSync.test.js`, `functions/shared/*` 동기화 | **Codex** | **완료·Claude 검수대기** — 171/171. 검사 모드 exit 0, `mfdsParser.js` 동기화 완료. `verify-mfds.mjs`는 실행 환경 네트워크 차단으로 `fetch failed` → `orders/15` |
| `src/lib/mfdsParser.js` 기준 단위↔1회분 단위 일치 판정 + 테스트 | **Codex** | **구현·단위검증 완료, Claude 동기화·실데이터 검증 대기** — 타깃 51/51, shared-sync 제외 전체 202/202. `functions/` 수정 금지로 `npm test`의 shared-sync만 실패(204 pass / 2 fail), `check-shared-sync.mjs` exit 1. `verify-mfds.mjs`는 첫 질의에서 `fetch failed`라 분포 판정 불가 → `orders/16` |
| `src/lib/quickFoodInput.js`, `tests/quickFoodInput.test.js` 다중 빠른 입력 분리 | **Codex** | **완료·Claude 검수대기** — 타깃 21/21, 전체 216/216. `verify-mfds.mjs`는 첫 질의 `김밥`에서 `fetch failed` (exit 2) → `orders/17` |
| `src/lib/quickFoodInput.js`, `tests/quickFoodInput.test.js` `unsupported-serving` 수량·단위 보존 | **Codex** | **완료·Claude 검수대기** — 타깃 23/23, 전체 218/218, shared-sync 통과. `verify-mfds.mjs`는 첫 질의 `김밥`에서 `fetch failed` (exit 2) → `orders/18` |
| `src/lib/quickFoodInput.js`, `tests/quickFoodInput.test.js` 이름 대조에 제조사 포함 | **Codex** | **완료·Claude 검수대기** — 타깃 27/27, 전체 222/222, shared-sync 통과. `verify-mfds.mjs`는 첫 질의 `김밥`에서 `fetch failed` (exit 2) → `orders/19` |
| `src/lib/quickFoodInput.js`, `tests/quickFoodInput.test.js` 더 정확한 후보 선택 | **Codex** | **완료·Claude 검수대기** — 타깃 34/34, 전체 229/229, shared-sync 통과. `verify-mfds.mjs`는 첫 질의 `김밥`에서 `fetch failed` (exit 2) → `orders/20` |
| `src/lib/roulette.js`, `tests/roulette.test.js` | **Codex** | **완료·Claude 검수대기** — 타깃 39/39, 전체 268/268, shared-sync 통과 → `orders/21` |
| `src/lib/mfdsParser.js`, `src/lib/quickFoodInput.js` + 테스트 | **Codex** | **구현·단위검증 완료, Claude 동기화·실데이터 검증 대기** — 타깃 89/89, 전체 270/272. `functions/` 수정 금지로 shared-sync만 2건 실패, `verify-mfds.mjs`는 첫 질의 `김밥`에서 `fetch failed`라 분포 확인 불가 → `orders/22` |
| `src/lib/roulette.js`, `tests/roulette.test.js` 검색 캐시 후보 변환 | **Codex** | **구현·타깃검증 완료, Claude 검수대기** — 타깃 45/45, 전체 277/279. 발주 22·24의 `functions/shared/mfdsParser.js` 동기화 대기 때문에 shared-sync만 2건 실패 → `orders/23` |
| `src/lib/mfdsParser.js`, `tests/mfdsParser.test.js` 1회분 100 가드 | **Codex** | **구현·타깃검증 완료, Claude 동기화·실데이터 검증 대기** — 타깃 56/56, 전체 277/279. `functions/` 수정 금지로 shared-sync만 2건 실패, `verify-mfds.mjs`는 첫 질의 `김밥`에서 `fetch failed` (exit 2) → `orders/24` |
| `src/lib/roulette.js`, `tests/roulette.test.js` 후보 풀 크기 제한 | **Codex** | **완료·Claude 검수대기** — 타깃 53/53, 전체 287/287, shared-sync 통과 → `orders/25` |
| `src/lib/servingEstimate.js`, `tests/servingEstimate.test.js` 카테고리 대표 중량 참고값 | **Codex** | **완료·Claude 검수대기** — 타깃 10/10, 전체 297/297, 실제 표 파일 확인 → `orders/26` |
| `public/index.html`, `app.js`, `sw.js`, `db.js`, `firebase.json`, `firestore.rules` | Claude | **완료·배포·실측검증 통과** |
| `functions/index.js`, `functions/shared/mfdsParser.js` (searchFoods) | Claude | **완료·배포·실측검증 통과** — Blaze 업그레이드 후 |
| `../coin-bot/{AGENTS,CLAUDE}.md`, `../scripts/check-doc-split.sh` | **Codex** | **완료·커밋** (`coin-bot` `da1d4e2`, root `c260784`) |
| `../stock/{AGENTS,CLAUDE}.md` | **Codex** | **완료·커밋** (`stock` `b65892c`) |

## Codex 발주 대기열

| 순서 | 작업 | 명세 준비 | 발주 | 내 리뷰 | 사용자 컨펌 |
|---|---|---|---|---|---|
| 1 | 대사량·매크로 계산 + 테스트 | ☑ `orders/01` | ☑ | ☑ | ☑ |
| 2 | 단위 환산 + 테스트 | ☑ `orders/01` | ☑ | ☑ | ☑ |
| 3 | 계산 엔진 에러 메시지 보강 (발주01 리뷰 구멍 5건) | ☑ `orders/03` | ☑ | ☑ | ☑ |
| 4 | 식약처 응답 파서 | ☑ `orders/04` (실응답+공식필드매핑 확보) | ☑ | ☑ | ☑ |
| 5 | 월 캘린더 그리드 날짜계산 + 상태판정 | ☑ `orders/05` | ☑ | ☑ | ☑ |
| 6 | 일간 합계 집계 | ☑ `orders/06` | ☑ | ☑ | ☐ |
| 7 | 식약처 파서 — items 배열형 대응 | ☑ `orders/07` | ☑ | ☑ | ☐ |
| 8 | 최근 항목 집계 (빈도·최근성 정렬) | ☐ (실사용에선 단순 최근순으로 충분해 발주 안 함) | ☐ | ☐ | ☐ |
| 9 | 룰렛 solver | ☑ `orders/21` | ☑ | ☐ | ☐ |
| 10 | 인증 검증 + 에러 메시지 | ☑ `orders/08` | ☑ | ☑ | ☐ |

> 문서 중복 제거(`orders/02`, coin-bot·stock)는 이 프로젝트 대기열이 아니라 워크스페이스 루트 `AGENTS.md` 작업이었다 — 완료·커밋됨.

**게이트:** 리뷰와 컨펌 둘 다 체크되기 전엔 머지하지 않는다.

## 확인 안 된 가설 (사실로 쓰지 말 것)

- ~~iOS standalone PWA에서 `getUserMedia` 권한이 유지되는지~~ → **확인됨 (2026-08-13, 실기기).**
  **유지 안 됨 — 앱 재실행마다 다시 물어본다.** Phase 8(바코드) 설계에 직접 영향:
  "한 번 허용하면 끝"을 전제로 못 짠다. 매번 권한요청 UI가 뜬다는 걸 바코드 스캔 진입 흐름에
  반영해야 한다 (예: 스캔 버튼 누를 때마다 프롬프트가 뜰 수 있다고 안내하는 문구 필요할 수 있음
  — **디자인 판단, Phase 8에서 사용자와 정한다**)
- ~~식약처 API의 실제 응답 스키마~~ → **확인됨 (2026-08-13)**, `docs/orders/04-mfds-parser.md` 참조. 레이트리밋(개발계정 트래픽 10,000/일)은 실사용 전 재확인 필요
- Open Food Facts의 국내 제품 커버리지 → 실 API 변환은 확인, **국내 바코드 10개 실기기 판독으로 판단**
- zxing-wasm@3.1.3이 iOS Safari에서 실용적 속도가 나오는지 → **배포 후 물리 기기 실측**

전부 확인 전에는 이 위에 코드를 얹지 않는다.
