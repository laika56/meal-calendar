# 발주33 — CDN 고정 버전 가드

- **등급**: 자동 (순수 함수 + 수용 기준 전부 실행 가능)
- **워크트리**: `/Users/jh/desktop/claude/.worktrees/meal-calendar/cdn-pin` (브랜치 `codex/cdn-pin`)
- **잡는 파일**: `src/lib/pinnedDeps.js`(신규) · `tests/pinnedDeps.test.js`(신규)
  · `docs/NEXT.md`(「작업 분담 현황」 갱신)
  **그 셋 말고는 건드리지 않는다.** `public/*.js` 도 고치지 않는다 — 이번 발주는 **검사만** 만든다

> `docs/NEXT.md` 는 `AGENTS.md:151`(「작업 시작 전과 끝난 후 '작업 분담 현황' 을
> 갱신한다」)이 **요구**하는 것이다. 초판은 그걸 빼놓고 「두 파일만」이라 적어서
> 계약과 정면 충돌했고, Codex 가 옳게 반려했다. 발주31 도 같은 충돌로 반려된
> 적이 있다(`74be1ac`) — 두 번째다.

## 왜

**⚠️ 이 절은 2026-08-21 에 고쳐졌다.** 초판은 `public/barcodeOcr.js` 가 이 브랜치에
있다고 전제했는데 **없다** — 그 파일은 아직 머지 안 된 `codex/barcode-wiring` 에만 있다.
Codex 가 그걸 잡아내고 반려했다(수용 기준의 변조 시험이 원리적으로 성립 불가였다).
**master 기준으로 다시 쓴 것이 아래다.**

지금 이 브랜치에 있는 tesseract URL 은 **하나뿐**이다:

```
public/nutritionLabelOcr.js:1 const TESSERACT_MODULE = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
```

**그런데 곧 둘이 된다.** `codex/barcode-wiring` 이 머지되면 `public/barcodeOcr.js` 가
같은 URL 을 **자기 파일에 따로** 들고 들어온다. 한쪽만 올리면 두 OCR 경로가 다른
빌드를 받는데 온라인에선 둘 다 동작해서 아무도 모른다 — 발주32(공용 모듈 드리프트
검증)가 잡으려던 것과 **정확히 같은 형태**다.

**그래서 가드를 먼저 세운다.** 머지되는 순간 중복이 자동으로 걸리게 한다.
지금은 파일이 하나뿐이라 `version-mismatch` 를 실제로 만들 수 없으므로,
아래 수용 기준의 변조 시험은 **`unpinned` 경로로 한다**(단일 파일에서도 성립한다).

두 번째 위험은 **느슨한 핀**이다. `@7` 이나 `@latest` 로 쓰면 우리가 아무것도
안 해도 앱이 어느 날 깨진다. `zxing-wasm` 은 `uiRedesignShell.test.js` 가
고정 URL 을 정규식으로 대조하고 있는데 **tesseract 는 그 가드가 없다.**

## 만들 것

### `src/lib/pinnedDeps.js`

DOM·네트워크·`node:fs` 를 import 하지 않는다. 문자열만 받는 순수 모듈이다.
(파일을 읽는 건 테스트 쪽 책임이다 — 발주32 의 `sharedSync.js` 와 같은 구조다.)

```js
export function extractCdnPins(source)
export function comparePinnedDeps(entries)
```

#### `extractCdnPins(source)`

- `source`: 파일 내용 문자열. **문자열이 아니면 `TypeError`를 던진다**
- 반환: `{ url, package, version }` 객체 배열. **`url` 의 단순 문자열 비교(오름차순)로 정렬**한다
  (`localeCompare` 를 쓰지 않는다 — 로케일에 따라 순서가 달라진다)
- 인식 대상: `https://cdn.jsdelivr.net/npm/...` 과 `https://unpkg.com/...` 두 호스트만
- `package` 는 **스코프 패키지(`@scope/name`)를 지원**한다
- `version` 은 패키지명 뒤 `@` 와 그다음 `/` 사이의 문자열 전체다
- URL 이 하나도 없으면 빈 배열

#### `comparePinnedDeps(entries)`

- `entries`: `[{ name, source }]` 배열. **배열이 아니면 `TypeError`를 던진다**
  - `name`: 파일 이름(문제 보고에 그대로 실린다)
  - `source`: 그 파일 내용
- 반환: `{ ok, problems }`
  - `ok`: `problems.length === 0`
  - `problems`: 아래 두 종류. **`package` 오름차순 → 같으면 `kind` 오름차순**으로 정렬 (둘 다 단순 문자열 비교)

| `kind` | 언제 | 담는 필드 |
|---|---|---|
| `unpinned` | `version` 이 `/^\d+\.\d+\.\d+$/` 에 안 맞을 때 (`7`, `^7.0.0`, `latest` 등) | `package`, `kind`, `version`, `files`(그 버전을 쓰는 파일 이름들, **오름차순 정렬**) |
| `version-mismatch` | 같은 `package` 가 **서로 다른 버전 2개 이상**으로 나타날 때 | `package`, `kind`, `versions`(**오름차순 정렬**) |

- 한 패키지가 두 조건에 다 걸리면 **문제 2건이 다 들어간다** (하나로 합치지 않는다)
- **같은 파일 안에 같은 URL 이 두 번 나오면** 그 파일 이름이 `files` 에 두 번 들어간다.
  중복을 제거하지 않는다 — 어디에 몇 개 있는지가 정보다

## 예시 입출력 (참조 구현으로 생성한 것. 손으로 채우지 않았다)

아래 상수를 쓴다:

```
T      = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js'
T8     = 'https://cdn.jsdelivr.net/npm/tesseract.js@8.0.0/dist/tesseract.esm.min.js'
Tloose = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.esm.min.js'
Z      = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/reader/index.js'
S      = 'https://unpkg.com/@scope/pkg@1.2.3/x.js'
```

| 입력 `entries` | 기대 반환 |
|---|---|
| `[]` | `{"ok":true,"problems":[]}` |
| `[{name:'a.js',source:T},{name:'b.js',source:T}]` | `{"ok":true,"problems":[]}` |
| `[{name:'a.js',source:T},{name:'b.js',source:T8}]` | `{"ok":false,"problems":[{"package":"tesseract.js","kind":"version-mismatch","versions":["7.0.0","8.0.0"]}]}` |
| `[{name:'a.js',source:Tloose}]` | `{"ok":false,"problems":[{"package":"tesseract.js","kind":"unpinned","version":"7","files":["a.js"]}]}` |
| `[{name:'a.js',source:T+'\n'+Z}]` | `{"ok":true,"problems":[]}` |
| `[{name:'a.js',source:S}]` | `{"ok":true,"problems":[]}` |
| `[{name:'a.js',source:'const x=1;'}]` | `{"ok":true,"problems":[]}` |

`extractCdnPins` 단독:

| 입력 | 기대 반환 |
|---|---|
| `S` | `[{"url":"https://unpkg.com/@scope/pkg@1.2.3/x.js","package":"@scope/pkg","version":"1.2.3"}]` |
| `Z+'\n'+T` → `.map(p => p.package)` | `["tesseract.js","zxing-wasm"]` (URL 문자열 정렬 결과다. 등장 순서가 아니다) |

**경계 케이스 기대 동작:**

| 입력 | 기대 |
|---|---|
| `extractCdnPins(null)` · `extractCdnPins(123)` | `TypeError` |
| `comparePinnedDeps(null)` · `comparePinnedDeps('x')` | `TypeError` |
| `extractCdnPins('')` | `[]` |
| 우리 호스트가 아닌 CDN (`https://cdn.example.com/npm/x@1.0.0/y.js`) | 무시한다(빈 배열) |

## `tests/pinnedDeps.test.js`

1. **위 예시 표 전부**를 테스트로 옮긴다 (경계 케이스 포함)
2. **실파일 테스트 1건**을 반드시 넣는다 — 이게 이 발주의 본체다:
   - `public/` 의 `.js` 파일을 **`readdirSync` 로 훑어서**(목록을 손으로 적지 않는다) 읽고
     `comparePinnedDeps` 에 넣는다
   - `ok === true` 를 단언한다. 실패 메시지에 `problems` 를 `JSON.stringify` 해서 넣는다
   - 발주32 의 `tests/sharedSync.test.js` 마지막 테스트가 같은 구조다. **그 파일을 참고한다**

**테스트는 구현을 보고 베끼지 말고 위 표에서 유도한다.**

## 수용 기준 (Codex 가 돌리고 출력 그대로 붙인다)

```
1. node --test tests/pinnedDeps.test.js
   → 전부 통과, fail 0

2. 일부러 깨뜨려서 잡히는지 확인한다 (이게 이 발주의 핵심이다)
   이 브랜치엔 tesseract URL 이 하나뿐이라 version-mismatch 는 만들 수 없다.
   느슨한 핀으로 깨뜨린다:
   sed -i '' 's|tesseract.js@7.0.0|tesseract.js@7|' public/nutritionLabelOcr.js
   node --test tests/pinnedDeps.test.js
   → **실패해야 한다.** 실패 메시지에 unpinned 와 "version":"7" 이 보여야 한다
   git checkout public/nutritionLabelOcr.js
   node --test tests/pinnedDeps.test.js
   → 다시 통과

   위 4줄의 출력을 전부 붙인다. 통과만 붙이면 그 테스트는 가짜일 수 있다.

3. npm test
   → fail 0

4. git status --porcelain
   → 2번에서 되돌린 게 남아 있지 않은지 확인. public/ 에 변경이 있으면 실패

5. git diff --stat master..HEAD
   → src/lib/pinnedDeps.js · tests/pinnedDeps.test.js · docs/NEXT.md 세 개만
     (docs/NEXT.md 는 AGENTS.md:151 이 요구하는 갱신이다)
```

## 하지 않을 것

- **`public/*.js` 의 중복 URL 자체를 고치지 않는다.** 두 파일이 한 상수를 공유하게
  만드는 건 서비스워커 셸 목록(`SHELL_FILES`)과 얽혀서 「주의」 구간이다.
  이번 발주는 **검사를 세우는 것까지**다. 고치는 건 그다음 판단이다
- `tests/uiRedesignShell.test.js` 의 기존 zxing 정규식 대조를 건드리지 않는다.
  중복돼 보여도 그쪽은 셸 HTML 검사라 소유가 다르다
