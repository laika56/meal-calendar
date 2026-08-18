# NEXT — 세션 시작점

**이 파일이 현재 상태의 단일 출처다.** 다른 곳에 진행 목록을 만들지 않는다.

최종 갱신: 2026-08-18

## 지금 상태

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
