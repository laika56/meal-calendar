# Handoff — 2026-08-13

## Goal

`meal-calendar` (식단관리 iOS PWA) 개발 + Claude↔Codex 워크스페이스 협업 계약 구축.

## Done

**`meal-calendar/` 커밋 9개** (`7f917b8`~`e2a08c0`):
- 초안 전제 4개 뒤집음: 바코드=ZXing-wasm(iOS에 BarcodeDetector 없음), 식품DB=식약처+OFF, 캘린더=CSS Grid자작, 룰렛=로컬solver
- 문서 6종(`NEXT`/`ROADMAP`/`SPEC`/`ARCHITECTURE`/`DECISIONS`/`AGENTS`), 서브에이전트 3종, iOS 검증페이지+아이콘, 테스트러너(node:test)
- **로드맵 재배치**: 바코드·식품DB를 뒤로(Phase 7~8, 선택), 프리셋·최근항목을 앞으로(Phase 4). 기준: "기록이 10초 안에 끝나나". API키 승인이 임계경로에서 빠짐 — Firebase만 있으면 v1(Phase 0~5) 완성 가능
- **Codex 발주 01 완료·리뷰함**: `src/lib/metabolism.js`, `units.js` + 테스트 22/22 통과. 명세 버그(`calcTargets`가 `bmr` 못 받는데 반환하려 함)를 Codex가 구현 전에 멈추고 지적 → `buildGoalProfile`로 분리해 수정
- **리뷰 중 구멍 5개 발견** — 아직 미수정 (아래 참조)

**워크스페이스 루트 커밋 4개** (`a6024fe`~`8d1f471`):
- `AGENTS.md`를 공통 계약으로, `CLAUDE.md`는 `@AGENTS.md` 임포트 (Codex/Claude 중복 방지)
- Codex 절차 기본값 확정(브랜치 유지·커밋안함·의존성금지 등) — "절차는 안 묻고 설계만 묻는다"
- 리뷰 프로토콜: 로그 안 읽음, 테스트 실행→diff→구현만→명세대조 순
- `scripts/codex-order.sh` 래퍼 — `codex exec`의 stdin 멈춤 + reasoning effort 기본 none 두 함정 방지
- Codex 루트 trusted 등록 (`~/.codex/config.toml`, 백업 있음)

**메모리 저장 5건**: MCP인증 지연, Codex우선순서, 일끌어안지말것, codex-claude계약, meal-calendar프로젝트

## In progress / next

**즉시 (Sonnet으로):**
1. **발주 03 (미작성)** — 발주01 리뷰에서 나온 구멍 5개 수정: `TypeError`에 메시지 없음, `undefined` 입력이 조용히 `NaN` 전파(`kjToKcal`/`calcTDEE`/`scaleNutrients`), `calcTargets`가 내부 구현("Cannot destructure...") 노출. 절대규칙 7("퇴화 케이스 조용히 뭉개지 않는다") 위반
2. **발주 02는 이미 써짐** (`docs/orders/02-doc-dedup.md`) — `coin-bot` 90줄 중복 제거 + `stock/AGENTS.md` 신설 + 재사용 검증스크립트. 아직 안 던짐
3. `scripts/codex-order.sh meal-calendar docs/orders/0X-*.md` 로 던지기 — **손으로 `codex exec` 치지 말 것**

**블로커 (사용자):**
- Firebase 프로젝트+웹앱+Hosting — Phase 3의 전부가 여기 매달림, HTTPS 없으면 카메라검증도 불가
- 식약처 API키 — 이제 급하지 않음(Phase 7까지 불필요), 승인대기 기니 신청만 걸어두면 됨

**확인 안 됨:**
- `CLAUDE.md`의 `@AGENTS.md` 임포트가 실제로 로드되는지 — **다음 세션 `/context`로 확인 필수.** 안 먹으면 계약 구조 전체를 다른 방식으로 바꿔야 함

## Decisions made

- **바코드/식품DB를 뒤로, 프리셋을 앞으로** — "10초 안에 기록되나"가 유일한 우선순위 기준. 유저가 "초안 수정해도 된다"고 명시적으로 허가
- **Codex 넘기는 기준 = "틀렸을 때 되돌릴 수 있나"**, 비용 아님 (Pro x20이라 분량 제약없음)
- **Codex 우선 발주** — 유저 지시. 사이클 시작 = Codex 먹일 명세부터 씀, Claude 구현은 그 다음
- **API 아닌 `codex exec` 사용** — auth_mode=chatgpt(구독), API키 쓰면 이중과금
- **모델 라우팅 미준수가 오늘 최대 낭비였음** — 문서967줄:코드299줄 전부 Opus로 씀. CLAUDE.md에 이미 "문서갱신=Sonnet" 규칙 있었는데 안 지킴. **이번 세션부터 Sonnet 사용중**

## Watch out for

- **`codex exec`는 반드시 `scripts/codex-order.sh`로.** 손으로 치면 `</dev/null`이나 `-c model_reasoning_effort="high"`를 빠뜨리기 쉽고, 후자는 에러 없이 조용히 품질만 떨어짐
- **Codex 실행 로그를 읽지 않는다.** 발주01 로그 4,467줄, 산출코드 299줄 — 로그 읽으면 리뷰비용이 절약분을 역전시킴. `AGENTS.md`의 리뷰 5단계 프로토콜을 따를 것
- **워크스페이스는 원격 없는 1인 로컬 저장소.** `meal-calendar`도 마찬가지 — 브랜치·워크트리 만들지 말 것(이미 계약에 명시했지만 Codex가 한 번 물어봄)
- 옵시디언 볼트(`laika`)에 `식단앱.md` 신설, `결정기록.md`에 섹션 추가함 — Codex 작업대상 아님
- `stock/`엔 아직 `AGENTS.md` 없음 (발주02가 이걸 만듦)
