# NEXT — 세션 시작점

**이 파일이 현재 상태의 단일 출처다.** 다른 곳에 진행 목록을 만들지 않는다.

최종 갱신: 2026-08-13

## 지금 상태

**Phase 1 셸 완료·배포·실기기 브라우저 검증까지 끝남 (2026-08-13).**
`https://calorie-43692.web.app` 에서 월 캘린더(더미데이터) + 일간상세 뼈대 동작.

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

Phase 1 끝. 브라우저(claude-in-chrome)로 검증 완료 — **아직 실기기(아이폰)로는 확인 안 됨, 사용자 확인 필요.**

**Phase 1에서 실제로 잡은 버그 3개** (배포는 매번 성공했는데 브라우저에서 안 바뀐 것처럼 보이던 것들.
전부 `docs/ARCHITECTURE.md` 「서비스워커 스코프」에 근거 정리):
1. SW를 `/public/sw.js`로 등록해서 스코프가 `/public/`로 좁아짐 (루트 페이지를 SW가 못 건드림)
2. SW가 cache-first라 재배포해도 브라우저가 헌 버전을 계속 씀
3. `app.js`/`.html`에 `max-age=3600` 캐시헤더가 붙어서 SW를 고쳐도 브라우저 HTTP 캐시가 안 풀림

**그 다음:**
1. 사용자가 아이폰에서 `https://calorie-43692.web.app` 열어서 캘린더·일간상세 확인 (홈화면 재추가 필요할 수 있음 — manifest 안 바뀌었으면 그대로 써도 됨)
2. Phase 2: 계산 엔진(발주01+03, 완료됨)을 화면에 실제로 연결 — 지금은 `DUMMY_TARGET_KCAL = 2000` 고정값
3. Phase 3: Firestore 연동 (지금은 `firebaseConfig.js`만 있고 실제 읽기/쓰기 없음)
4. Phase 8 설계 시 카메라 권한 재요청 UX 반영 (위 참조)

## 작업 분담 현황

넘기기 전에 여기 적는다. 같은 파일을 둘이 동시에 잡지 않는다.

| 대상 | 잡은 쪽 | 상태 |
|---|---|---|
| `src/lib/metabolism.js`, `src/lib/units.js` + 테스트 | **Codex** | **완료·커밋** (`meal-calendar` `0a1cf7c`) → `orders/01`, `orders/03` |
| `src/lib/mfdsParser.js`, `tests/mfdsParser.test.js` | **Codex** | **완료·커밋** (`07cff69`) → `orders/04` |
| `src/lib/calendarGrid.js`, `tests/calendarGrid.test.js` | **Codex** | **완료·리뷰통과·미커밋** — `npm test` 55/55 → `orders/05` |
| `public/index.html`, `app.js`, `sw.js`, `firebase.json` (캘린더 셸, 더미데이터) | Claude | **완료·배포·브라우저검증 통과·미커밋** — SW스코프/캐싱 버그 3개 발견·수정 |
| `../coin-bot/{AGENTS,CLAUDE}.md`, `../scripts/check-doc-split.sh` | **Codex** | **완료·커밋** (`coin-bot` `da1d4e2`, root `c260784`) |
| `../stock/{AGENTS,CLAUDE}.md` | **Codex** | **완료·커밋** (`stock` `b65892c`) |

## Codex 발주 대기열

| 순서 | 작업 | 명세 준비 | 발주 | 내 리뷰 | 사용자 컨펌 |
|---|---|---|---|---|---|
| 1 | 대사량·매크로 계산 + 테스트 | ☑ `orders/01` | ☑ | ☑ | ☑ |
| 2 | 단위 환산 + 테스트 | ☑ `orders/01` | ☑ | ☑ | ☑ |
| 3 | 계산 엔진 에러 메시지 보강 (발주01 리뷰 구멍 5건) | ☑ `orders/03` | ☑ | ☑ | ☑ |
| 4 | 식약처 응답 파서 | ☑ `orders/04` (실응답+공식필드매핑 확보) | ☑ | ☑ | ☑ |
| 5 | 월 캘린더 그리드 날짜계산 + 상태판정 | ☑ `orders/05` | ☑ | ☑ | ☐ |
| 6 | 룰렛 solver | ☐ (Phase4 프리셋 설계 선행 필요) | ☐ | ☐ | ☐ |

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
