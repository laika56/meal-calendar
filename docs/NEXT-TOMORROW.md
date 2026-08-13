# 내일 여기서 시작한다 (2026-08-13 밤 작성)

> `docs/NEXT.md` 가 여전히 전체 상태의 단일 출처다.
> 이 파일은 **다음 한 걸음만** 적은 것이고, 그게 끝나면 지워도 된다.

## 지금 어디까지

배포됨: `https://calorie-43692.web.app` · 테스트 **159개 전부 통과** · 작업트리 깨끗.

오늘 끝난 것: 계정 복구(비회원/회원) · 성능(SW 캐싱·로딩 상태) ·
**식약처 검색 대개조**(브랜드 검색 · 1회분 판정 · 실데이터 검증기).

## 다음 한 걸음 — Cloud Functions 배선

**순수 로직은 다 만들어져 있다. 아직 아무도 안 쓴다.**

| 이미 있는 것 | 하는 일 |
|---|---|
| `src/lib/searchPlan.js` | 검색어 → 질의 계획 최대 4개 |
| `src/lib/searchResults.js` | 여러 질의 결과 병합·중복제거·순위 |
| `src/lib/mfdsParser.js` | `basis`·총중량·1회분·제조사·식품군 파싱 + `resolveServing()` |

`functions/index.js` 는 **아직 옛 방식**이다 — 검색어를 `FOOD_NM_KR` 에 통째로 한 번 넣는다.

### 할 일

1. `functions/shared/mfdsParser.js` 를 `src/lib/mfdsParser.js` 와 동기화
   (`searchPlan.js`·`searchResults.js` 도 복사본이 필요하다)
2. `functions/index.js`: `buildSearchPlan(q)` 로 계획을 만들고 **앞에서부터 시도,
   결과가 나오면 멈춘다.** 시도한 것들을 `mergeSearchResults` 로 합치고
   `rankSearchResults(items, q)` 로 정렬해서 반환
3. 응답에 `resolveServing()` 결과를 실어 보낸다 — UI 가 「1개」를 그리려면 필요하다
4. 배포 후 `서가원 김밥`·`맥도날드 빅맥`·`프로틴` 으로 실측

**이건 Claude 몫이다** (`functions/` 는 API 키를 만진다 — Codex 대상 아님).

### 그다음 — UI

「빅맥 1개」처럼 **개수로 기록**. `resolveServing()` 이 `null` 이 아니면 개수 입력을
기본으로 주고, `null` 이면 지금처럼 g 을 받는다. 실데이터 기준 **94% 가 개수로 된다.**

## 무인으로 돌리려면

```bash
# 발주 목록은 docs/orders/QUEUE.md 에 있다
/Users/jh/Desktop/claude/scripts/codex-overnight.sh meal-calendar docs/orders/<파일>.md

# 다 끝나고 컴퓨터를 끄려면
/Users/jh/Desktop/claude/scripts/codex-overnight.sh --shutdown meal-calendar docs/orders/<파일>.md
```

- 수용 기준(`npm test` + `node scripts/verify-mfds.mjs`)을 **통과한 것만 커밋**한다.
  실패하면 파일은 남기고 커밋하지 않는다 — 아침에 사람이 판단한다
- **디스코드로 보고받으려면** 웹훅 URL 을 넣는다:
  ```bash
  export CODEX_DISCORD_WEBHOOK='https://discord.com/api/webhooks/...'
  ```
  Discord → 채널 설정 → 연동 → 웹후크 → 새 웹후크 → URL 복사.
  안 넣으면 조용히 건너뛴다(에러 아님).
- `--shutdown` 은 `osascript` 를 쓴다. `sudo shutdown` 은 비밀번호를 물어서 무인에 못 쓴다.
  **저장 안 된 문서가 있는 앱이 떠 있으면 종료가 막힐 수 있다** — 돌리기 전에 정리한다

## 확인 안 된 것 (사실로 쓰지 말 것)

- **iOS 실기기**: iCloud 키체인 저장 제안, 재설치 후 기록 생존 → `docs/IOS-AUTH-CHECK.md`
- 성능 수정(SW stale-while-revalidate)의 폰 체감 — **앱을 두 번 열어야** 빨라진다
- 계정 전환 시 Firestore 오프라인 캐시에 이전 uid 데이터가 남는지

## 정리해야 할 것

Firebase 콘솔 → Authentication → Users 에서 시험 계정 삭제:
`c1test-a@example.com` 과 버려진 익명 계정들.
