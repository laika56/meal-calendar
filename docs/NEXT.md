# NEXT — 세션 시작점

**이 파일이 현재 상태의 단일 출처다.** 다른 곳에 진행 목록을 만들지 않는다.

최종 갱신: 2026-08-14

## 지금 상태

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

**나중 (Phase 8):** 카메라 권한 재요청 UX 반영 (위 참조)

## 작업 분담 현황

넘기기 전에 여기 적는다. 같은 파일을 둘이 동시에 잡지 않는다.

| 대상 | 잡은 쪽 | 상태 |
|---|---|---|
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
| 9 | 룰렛 solver | ☐ (Phase4 프리셋 설계 선행 필요) | ☐ | ☐ | ☐ |
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
- Open Food Facts의 국내 제품 커버리지 → **바코드 10개쯤 찍어보고 판단**
- zxing-wasm이 iOS Safari에서 실용적 속도가 나오는지 → **실측**

전부 확인 전에는 이 위에 코드를 얹지 않는다.
