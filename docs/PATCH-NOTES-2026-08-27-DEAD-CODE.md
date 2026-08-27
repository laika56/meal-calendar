# 패치노트 — dead code 제거·중복 유틸 통합

날짜: 2026-08-27

작성: #코덱스

범위: 정적 감사에서 미사용이 입증된 코드 제거와 완전히 같은 로직의 공통화

## 제거

- `tests/harness.test.js`: 파일 자체에 실제 테스트가 생기면 삭제하라는 조건이 있었고,
  작업 전 전체 테스트는 651건이었다.
- `public/db.js`의 `loadAllGoals`, `addDislike`: Git 추적 JS/MJS/CJS 120개에서 정의 외
  참조가 0건이었다. 사용 중인 `loadDislikes`는 유지했다.
- `.env.example`의 `ANTHROPIC_API_KEY`, `OFF_USER_AGENT`: Git 추적 소스에서 참조가
  0건이었다. 실제 사용 중인 `MFDS_API_KEY`는 유지했다.
- `scripts/sync-shell-revision.mjs`: 같은 셸 파일 목록과 같은 SHA-256 계산으로
  `public/sw.js`를 갱신하는 `scripts/bump-shell-revision.mjs`와 기능이 겹쳤다.
  `--check`까지 제공하는 `bump-shell-revision.mjs`를 단일 명령으로 유지했다.

## 공통화

- 새 `scripts/canonical-json.mjs`에 기존 재귀 key 정렬 직렬화와 그 UTF-8 바이트의
  SHA-256 계산을 그대로 옮겼다.
- 다음 네 소비처의 중복 구현만 공통 유틸 import로 바꿨다.
  - `functions/import-barcode-catalog.mjs`
  - `functions/import-franchise-catalog.mjs`
  - `scripts/build-mfds-franchise-data.mjs`
  - `scripts/validate-franchise-data.mjs`

## 의도적으로 유지

- `src/lib/*`와 `functions/shared/*`의 6쌍은 Firebase Functions 배포 경계 때문에
  필요한 복제이며 `scripts/check-shared-sync.mjs`가 동일성을 검사한다.
- 파일·컴포넌트·import·직접 의존성·환경변수·주석 처리 블록을 정적으로 확인했지만,
  동적 문자열 참조와 외부 운영 호출은 정적 검색만으로 부재를 증명할 수 없어 삭제
  근거로 사용하지 않았다.

## TDD 기록

1. 제거 대상이 없어지고 공통 유틸 파일이 생겨야 한다는 테스트 5건을 먼저 작성했다.
   구현 전 5건 모두 실패했고, 최소 제거 후 5/5 통과했다.
2. canonical JSON 정렬·순서 독립성·정확한 SHA-256 테스트 3건을 먼저 추가했다.
   빈 유틸에서 3건 모두 `canonicalJson is not a function`으로 실패하는 것을 확인한 뒤
   구현했다.
3. 관련 카탈로그 회귀 테스트 45/45가 통과했다.

## 운영 영향

- 사용자 기능, Firestore 스키마, 카탈로그 형식과 해시 계산 결과는 바뀌지 않는다.
- `public/db.js` 바이트 변경에 맞춰 `SHELL_REVISION`을 공식 스크립트로 갱신했다.
- 커밋 `3dfbf83`을 Firebase Hosting에 배포했다. Functions, Firestore 규칙·데이터,
  의존성은 변경하지 않았다.

## 최종 검증

- `node --test --test-reporter=spec`
  - tests 656
  - pass 655
  - fail 0
  - skipped 1 (`firebase emulators:exec` 필요)
- 변경 JS/MJS 9개 `node --check`: 전부 통과
- `node scripts/check-shared-sync.mjs`: 공유 사본 6쌍 전부 일치
- `node scripts/bump-shell-revision.mjs --check`: 셸 40개, 최신
- `git diff --check`: 통과
- `canonicalJson` 정확한 함수 정의: 1개
- 삭제한 DB 함수 정의: 0개
- 제거한 환경변수 예시: 0개

## 배포 검증

- `firebase deploy --only hosting --project calorie-43692 --non-interactive`: 완료
- 배포 URL: `https://calorie-43692.web.app`
- HTTP 상태: 200
- 아래 5개 경로를 cache-busting query로 다시 받아 로컬 SHA-256과 대조했다.
  - `/`: 일치
  - `/public/index.html`: 일치
  - `/public/db.js`: 일치
  - `/sw.js`: 일치
  - `/public/sw.js`: 일치
