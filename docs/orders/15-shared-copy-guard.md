# 발주 15 — `functions/shared` 복사본 어긋남을 자동으로 잡는다

## 배경

Cloud Functions 는 `src/lib/` 를 직접 import 할 수 없어서(배포 번들이 분리된다)
**같은 파일의 복사본**을 `functions/shared/` 에 둔다.

문제는 **동기화를 사람이 기억해서 한다**는 것이다. `docs/NEXT.md` 에
"Functions 쪽 복사본도 동기화" 라고 적혀 있지만, 발주 09~13 을 거치며 실제로 벌어졌다:

```
$ diff -q src/lib/mfdsParser.js functions/shared/mfdsParser.js
Files ... differ
```

**어긋나도 아무 신호가 없다.** `npm test` 는 `src/lib/` 만 보고, 배포는 성공한다.
서버는 옛 파서로 돌고 브라우저는 새 파서로 돈다 — 증상이 나타날 때쯤엔 원인을 찾기 어렵다.

## 만들 파일

- `scripts/check-shared-sync.mjs` (신규)
- `tests/sharedSync.test.js` (신규)

## 1. `scripts/check-shared-sync.mjs`

`functions/shared/` 의 각 파일이 `src/lib/` 의 같은 이름 파일과 **내용이 같은지** 검사한다.

```bash
node scripts/check-shared-sync.mjs          # 검사만. 어긋나면 exit 1
node scripts/check-shared-sync.mjs --fix    # src/lib → functions/shared 로 복사하고 exit 0
```

### 동작

| 상황 | 검사 모드 | `--fix` 모드 |
|---|---|---|
| 내용 동일 | `✅` 출력, 계속 | 그대로 둠 |
| 내용 다름 | **exit 1**, 어느 파일인지 출력 | `src/lib/` 것을 덮어씀 |
| `functions/shared/X` 는 있는데 `src/lib/X` 가 없음 | **exit 1** — 고아 복사본이다 | **덮어쓰지 않는다.** 경고만 하고 exit 1 |
| `functions/shared/` 가 없거나 비어 있음 | `✅` (검사할 게 없다), exit 0 | 그대로 |

- **비교는 내용 그대로**다. 공백·줄바꿈 정규화를 하지 않는다 — 복사본은 글자까지 같아야 한다
- 출력은 한 줄씩: `✅ mfdsParser.js` / `❌ mfdsParser.js — 내용이 다르다`
- 어긋난 게 있으면 마지막에 **`node scripts/check-shared-sync.mjs --fix` 를 안내**한다
- `--fix` 는 **`src/lib` → `functions/shared` 한 방향만**이다. 반대로 덮어쓰지 않는다.
  원본은 언제나 `src/lib/` 다

### 주의

- 의존성 없이 `node:fs` 만 쓴다
- 경로는 스크립트 위치 기준(`import.meta.url`)으로 잡는다. 호출 시 cwd 에 의존하지 않는다
- **파일을 지우지 않는다.** 고아 복사본을 발견해도 삭제하지 말고 보고만 한다

## 2. `tests/sharedSync.test.js`

**테스트가 이 검사를 상시로 돌게 만든다.** 그래야 `npm test` 만으로 어긋남이 잡힌다.

- `functions/shared/` 의 각 파일에 대해, `src/lib/` 의 같은 이름 파일과
  내용이 같은지 `assert.strictEqual` 로 확인한다
- `functions/shared/` 가 없으면 **테스트를 건너뛰지 말고 통과**시킨다 (검사할 대상이 없는 것뿐)
- 고아 복사본(`src/lib` 에 짝이 없음)이 있으면 **실패**시킨다
- 실패 메시지에 **어느 파일인지와 `--fix` 명령**을 넣는다.
  단순히 "문자열이 다르다"만 나오면 무엇을 해야 할지 알 수 없다
- **파일 내용 전체를 assert 메시지에 넣지 않는다.** 수백 줄이 터미널을 덮는다 —
  파일명과 조치 방법만 넣는다

## 3. 이번 발주에서 실제 동기화까지 한다

지금 `functions/shared/mfdsParser.js` 가 어긋나 있다.
**`--fix` 를 돌려서 맞추고**, `npm test` 가 통과하는 것까지 확인한다.

> `functions/shared/` 아래 파일을 **내용 복사 목적으로** 쓰는 것은 허용한다.
> 그 외 `functions/` 의 다른 파일(특히 `index.js` — API 키를 만진다)은 건드리지 않는다.

## 테스트 요구사항

- `tests/sharedSync.test.js` 가 **지금 저장소 상태에서 실제로 통과**해야 한다
  (즉 3번의 동기화를 먼저 하고 나서 테스트가 초록이어야 한다)
- 스크립트를 **검사 모드로 직접 돌린 출력**을 완료 보고에 붙인다

## 수용 기준

```bash
node scripts/check-shared-sync.mjs   # exit 0
npm test                             # 기준선 169개 + 새 테스트
node scripts/verify-mfds.mjs         # 회귀 없음
```

## 하지 말 것

- 의존성 추가 금지 · 네트워크 호출 금지
- `functions/index.js` 를 건드리지 말 것 (API 키를 만진다 — Codex 대상 아님)
- `src/lib/` 의 파일 내용을 고치지 말 것. 이 발주는 **복사본을 원본에 맞추는 것**이다
- 파일을 지우지 말 것
- 표에 없는 규칙을 지어내지 말 것 — 비었으면 채우지 말고 보고한다
- **커밋하지 말 것**
