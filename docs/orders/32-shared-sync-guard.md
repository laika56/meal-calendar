# 발주32 — `src/lib` ↔ `functions/shared` 드리프트 검증

- **워크트리**: `.worktrees/meal-calendar/adhoc-2` (브랜치 `codex/adhoc-2`)
- **등급**: 자동 (순수 함수 + 수용 기준 전부 실행 가능)
- **잡는 파일**: `src/lib/sharedSync.js`(신규) · `tests/sharedSync.test.js`(신규)
  **`public/app.js` 를 건드리지 않는다** — 그건 발주31 소유다

## 왜

같은 모듈이 **두 벌** 있다. 앱용과 Cloud Functions 용이다:

```
src/lib/barcodeCatalogLookup.js  ↔  functions/shared/barcodeCatalogLookup.js
src/lib/franchiseCatalog.js      ↔  functions/shared/franchiseCatalog.js
src/lib/mfdsParser.js            ↔  functions/shared/mfdsParser.js
src/lib/searchPlan.js            ↔  functions/shared/searchPlan.js
src/lib/searchResults.js         ↔  functions/shared/searchResults.js
```

2026-08-20 기준 5쌍 전부 SHA-256 일치다. **그런데 일치를 강제하는 게 아무것도 없다.**
한쪽만 고치면 배포 후 **앱과 서버가 다른 로직으로 돈다** — 조용히, 테스트도 통과하면서.
이미 「hosting 만 배포해서 옛 파서가 돌았다」는 사고가 있었다. 그 사고의 정적 버전이다.

## 할 일

순수 비교 함수 + 그것을 실제 파일에 물리는 테스트.

```js
// src/lib/sharedSync.js
export function compareSharedModules(entries) { ... }
```

## 입출력 명세

### 시그니처

```
compareSharedModules(entries) -> Report
```

| 인자 | 형태 |
|---|---|
| `entries` | 배열. 각 원소 `{ name: string, appSource: string \| null, functionsSource: string \| null }` |

**파일을 읽지 않는다.** 문자열만 받는다 — 그래서 순수 함수다. 읽는 건 테스트가 한다.

### 정규화 (비교 전에 양쪽에 똑같이 적용)

이 셋만 무시한다. **그 외에는 한 글자도 봐준다고 생각하지 마라.**

| # | 무시하는 것 | 방법 |
|---|---|---|
| N1 | 선행 BOM (`﻿`) | 맨 앞 1글자면 제거 |
| N2 | 개행 종류 | `\r\n` → `\n`, 단독 `\r` → `\n` |
| N3 | 파일 끝 개행 유무 | 끝의 `\n` 을 전부 제거한 뒤 비교 |

**들여쓰기·공백·주석은 무시하지 않는다.** 주석이 다르면 다른 것이다 — 사본이니까.

### 판정

| 조건 | `status` |
|---|---|
| 정규화 후 두 문자열이 같다 | `'same'` |
| 정규화 후 다르다 | `'drift'` |
| `appSource` 만 `null` | `'missing-app'` |
| `functionsSource` 만 `null` | `'missing-functions'` |
| 둘 다 `null` | `'missing-both'` |

`''`(빈 문자열)은 **`null` 이 아니다.** 빈 파일끼리면 `'same'` 이다.

### 반환

```js
{
  ok: boolean,          // 모든 항목이 'same' 일 때만 true. 항목이 0개면 true
  entries: [ { name, status } ],   // name 오름차순 정렬 (localeCompare 아님 — 단순 < 비교)
  problems: [ { name, status } ],  // status !== 'same' 인 것만. 같은 정렬
}
```

### 예시

```js
compareSharedModules([])
// → { ok: true, entries: [], problems: [] }

compareSharedModules([{ name: 'a', appSource: 'x\n', functionsSource: 'x' }])
// → { ok: true, entries: [{ name: 'a', status: 'same' }], problems: [] }
//   N3 으로 끝 개행을 무시한다

compareSharedModules([{ name: 'a', appSource: 'x', functionsSource: 'x ' }])
// → ok: false, status: 'drift'   (끝 공백은 개행이 아니다)

compareSharedModules([{ name: 'b', appSource: null, functionsSource: 'x' }])
// → ok: false, status: 'missing-app'

compareSharedModules([
  { name: 'z', appSource: 'q', functionsSource: 'q' },
  { name: 'a', appSource: 'q', functionsSource: 'q' },
])
// → entries 의 순서는 ['a', 'z']
```

## 테스트

`tests/sharedSync.test.js` 는 **두 층**이다.

### 1층 — 순수 함수 (픽스처로)

위 규칙 표의 각 행에 최소 1건. 경계값 필수: 빈 배열, 원소 1개, `''` vs `null`,
BOM 있는 쪽/없는 쪽, `\r\n` 섞인 쪽, 끝 개행 2개 vs 0개, 정렬.

### 2층 — 실제 파일에 물린다

`functions/shared/` 의 `*.js` 를 **디렉터리에서 읽어 목록을 만든다.** 이름을 코드에 박지 않는다 —
사본이 하나 늘었을 때 테스트가 자동으로 따라와야 한다.

각 이름에 대해 `src/lib/<name>` 을 짝으로 읽는다(없으면 `null`).
`compareSharedModules` 를 돌려 **`ok === true` 를 단언한다.**

실패 메시지에 `problems` 를 그대로 넣어서 **어느 파일이 어긋났는지 보이게** 한다.

> 경로는 테스트 파일 기준 상대경로로 잡는다(`import.meta.url`). cwd 에 의존하지 마라 —
> `npm test` 와 `node --test tests/sharedSync.test.js` 가 둘 다 통과해야 한다.

## 수용 기준 (Codex 가 돌리고 출력 그대로 붙인다)

```
1. node --test tests/sharedSync.test.js
   → 전부 통과, fail 0

2. 일부러 깨뜨려서 잡히는지 확인한다 (이게 이 발주의 핵심이다)
   printf '\n// drift\n' >> functions/shared/searchPlan.js
   node --test tests/sharedSync.test.js
   → **실패해야 한다.** 실패 메시지에 searchPlan.js 와 'drift' 가 보여야 한다
   git checkout functions/shared/searchPlan.js
   node --test tests/sharedSync.test.js
   → 다시 통과

   위 4줄의 출력을 전부 붙인다. 통과만 붙이면 그 테스트는 가짜일 수 있다.

3. npm test
   → pass 549 이상, fail 0

4. git status --porcelain
   → 2번에서 되돌린 게 남아 있지 않은지 확인. functions/shared/ 에 변경이 있으면 실패

5. git diff --stat
   → src/lib/sharedSync.js · tests/sharedSync.test.js 두 개만
```

## 안 하는 것

- **두 벌을 하나로 합치지 않는다.** 왜 나뉘어 있는지(번들·배포 경계) 판단이 필요하고, 그건 Claude 몫이다.
  이 발주는 **어긋남을 검출**만 한다
- 자동 동기화(한쪽을 다른 쪽에 덮어쓰기) **만들지 않는다.** 잘못된 쪽이 어느 쪽인지 기계가 모른다
- `functions/shared/` 나 `src/lib/` 의 기존 파일을 **수정하지 않는다** (수용 기준 2번의 일시적 변경은 반드시 되돌린다)
- 의존성 추가 **금지.** `node:fs`·`node:path`·`node:test` 만 쓴다
