# 비회원/회원 인증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 익명 전용이던 인증을 「비회원 / 회원」 두 갈래로 나누고, 비회원이 uid 를 잃지 않고 이메일+비밀번호 회원으로 승격할 수 있게 만든다.

**Architecture:** `linkWithCredential` 로 익명 uid 에 이메일 자격을 붙인다 — uid 가 유지되므로 Firestore 데이터 이동과 보안 규칙 수정이 둘 다 없다. `public/db.js` 가 인증 API 를 전부 감싸고, `public/app.js` 는 `observeAuth` 콜백 하나로 게이트 화면과 캘린더를 전환한다. 순수 검증·메시지 로직은 `src/lib/` 로 빼서 Codex 가 테스트와 함께 만든다.

**Tech Stack:** 바닐라 JS (ESM, 빌드 없음) · Firebase Auth 12.4.0 (gstatic CDN) · Firestore · `node:test` 내장 러너

**스펙:** `docs/superpowers/specs/2026-08-13-auth-guest-member-design.md`

## Global Constraints

- **의존성 추가 금지.** 빌드 스텝 없음. `node:test` 외 테스트 러너 없음
- **`src/lib/` 는 순수하다** — DOM·네트워크·Firebase 를 import 하지 않는다
- 테스트는 `tests/*.test.js`. `node --test` 가 자동 탐색한다 — **디렉토리를 인자로 주면 실패한다** (Node 26)
- **에러 메시지에 `NaN` 을 넣을 때 `JSON.stringify` 를 쓰지 않는다** — `JSON.stringify(NaN)` 은 문자열 `"null"` 을 반환한다. 기존 `src/lib/dayTotals.js:8` 의 `formatValue()` 패턴을 따른다
- **보안 규칙(`firestore.rules`) 을 수정하지 않는다.** uid 가 불변이므로 기존 규칙이 그대로 성립한다
- **비밀번호 정책:** 최소 8자, 공백만으로 이루어진 값 거부, 가입 시 확인란 일치
- **autocomplete 속성은 기능이다:** `type="email" autocomplete="username"`, 가입 `autocomplete="new-password"`, 로그인 `autocomplete="current-password"`. 빼면 iCloud 키체인이 저장 제안을 하지 않고 실사용 복구율이 떨어진다
- 커밋은 **사용자가 요청할 때만.** Codex 는 어느 경우에도 커밋하지 않는다
- 브랜치·워크트리를 새로 만들지 않는다. `master` 에서 그대로 작업한다

---

## File Structure

| 파일 | 책임 | 담당 |
|---|---|---|
| `src/lib/authValidation.js` (신규) | 이메일 형식·비밀번호 정책 검증. 순수 | **Codex** |
| `src/lib/authMessages.js` (신규) | Firebase auth 에러 코드 → 한국어 문구. 순수 | **Codex** |
| `tests/authValidation.test.js` (신규) | 위 검증 테스트 | **Codex** |
| `tests/authMessages.test.js` (신규) | 위 매핑 테스트 | **Codex** |
| `docs/orders/08-auth-validation.md` (신규) | Codex 발주서 | Claude |
| `public/db.js` (수정) | 인증 API 교체 — `signIn()` 제거, 8개 함수 추가 | Claude |
| `public/index.html` (수정) | 게이트 시트 + 설정 계정 섹션 마크업 + CSS | Claude |
| `public/app.js` (수정) | `observeAuth` 기반 상태 전환, 폼 핸들러 | Claude |
| `docs/ARCHITECTURE.md` (수정) | 이메일 링크 전제를 뒤집은 결정 반영 | Claude |
| `docs/NEXT.md` (수정) | 진행 상태·분담 현황 갱신 | Claude |

---

### Task 1: Codex 발주 — 순수 검증/메시지 로직

`../AGENTS.md` 「순서 — Codex를 먼저 돌린다」. 이 태스크를 먼저 끝내고 발주를 걸어둔 뒤,
Codex 가 도는 동안 Task 2 이후를 병렬로 진행한다.

**Files:**
- Create: `docs/orders/08-auth-validation.md`
- (Codex 산출) Create: `src/lib/authValidation.js`, `src/lib/authMessages.js`
- (Codex 산출) Test: `tests/authValidation.test.js`, `tests/authMessages.test.js`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  ```js
  // src/lib/authValidation.js
  export function validateEmail(email)
    // → { ok: true } | { ok: false, reason: 'empty'|'format'|'tooLong' }
  export function validatePassword(password)
    // → { ok: true } | { ok: false, reason: 'empty'|'tooShort'|'whitespaceOnly' }
  export function validatePasswordConfirm(password, confirm)
    // → { ok: true } | { ok: false, reason: 'mismatch' }
  export function validateSignUpForm({ email, password, confirm })
    // → { ok: true } | { ok: false, field: 'email'|'password'|'confirm', reason: string }

  // src/lib/authMessages.js
  export function authErrorMessage(code)  // → 한국어 문자열 (모르는 코드는 폴백)
  export function validationMessage(field, reason)  // → 한국어 문자열
  ```

- [ ] **Step 1: 발주서 작성**

`docs/orders/08-auth-validation.md` 를 만든다. 아래 내용을 그대로 쓴다.

````markdown
# 발주 08 — 인증 검증 + 에러 메시지 (순수 로직)

## 배경

앱에 「비회원 / 회원」 인증을 붙인다. 회원가입·로그인 폼에서 쓸
**순수 검증 함수와 에러 문구 매핑**을 만든다. 이 파일들은 DOM·네트워크·Firebase 를
import 하지 않는다.

설계 문서: `docs/superpowers/specs/2026-08-13-auth-guest-member-design.md`

## 만들 파일

- `src/lib/authValidation.js`
- `src/lib/authMessages.js`
- `tests/authValidation.test.js`
- `tests/authMessages.test.js`

기존 `src/lib/dayTotals.js`, `src/lib/units.js` 의 스타일(ESM export, 주석 한국어,
`TypeError` 로 잘못된 타입 거부)을 그대로 따른다.

## `src/lib/authValidation.js`

### `validateEmail(email)`

| 입력 | 반환 |
|---|---|
| `'a@b.co'` | `{ ok: true }` |
| `'  a@b.co  '` | `{ ok: true }` — **앞뒤 공백은 제거하고 판정한다** |
| `''` | `{ ok: false, reason: 'empty' }` |
| `'   '` | `{ ok: false, reason: 'empty' }` |
| `'ab.co'` | `{ ok: false, reason: 'format' }` |
| `'a@'` | `{ ok: false, reason: 'format' }` |
| `'@b.co'` | `{ ok: false, reason: 'format' }` |
| `'a@b'` | `{ ok: false, reason: 'format' }` — 점 없는 도메인 거부 |
| `'a b@c.co'` | `{ ok: false, reason: 'format' }` — 내부 공백 거부 |
| 255자 초과 | `{ ok: false, reason: 'tooLong' }` (공백 제거 후 길이 기준) |
| `null`, `undefined`, 숫자, 객체 | `TypeError` — 문자열이 아니면 던진다 |

형식 검사는 **완벽한 RFC 파싱을 하지 않는다.** 오타를 걸러내는 게 목적이고
최종 판정은 Firebase 가 한다. 아래 정규식으로 충분하다:

```js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

### `validatePassword(password)`

| 입력 | 반환 |
|---|---|
| `'abcd1234'` (8자) | `{ ok: true }` |
| `'abcdefghij'` | `{ ok: true }` |
| `''` | `{ ok: false, reason: 'empty' }` |
| `'abcd123'` (7자) | `{ ok: false, reason: 'tooShort' }` |
| `'        '` (공백 8자) | `{ ok: false, reason: 'whitespaceOnly' }` |
| `'  ab  '` | `{ ok: false, reason: 'tooShort' }` — 6자 |
| `null`, 숫자, 객체 | `TypeError` |

- **비밀번호는 trim 하지 않는다** — 길이는 원본 그대로 센다. 사용자가 의도적으로
  앞뒤 공백을 넣었을 수 있다. 단 **전부 공백이면** `whitespaceOnly` 로 거부한다
- 최소 길이는 **8**. 상수로 뽑아 export 한다: `export const MIN_PASSWORD_LENGTH = 8;`
- 대소문자·특수문자 강제는 **하지 않는다**

판정 순서: `empty` → `whitespaceOnly` → `tooShort`

### `validatePasswordConfirm(password, confirm)`

| 입력 | 반환 |
|---|---|
| `('abcd1234', 'abcd1234')` | `{ ok: true }` |
| `('abcd1234', 'abcd12345')` | `{ ok: false, reason: 'mismatch' }` |
| `('abcd1234', '')` | `{ ok: false, reason: 'mismatch' }` |
| 둘 중 하나라도 문자열이 아니면 | `TypeError` |

**정확한 문자열 일치**로만 판정한다. trim 하지 않는다.

### `validateSignUpForm({ email, password, confirm })`

세 검사를 **이 순서로** 돌리고 **처음 실패한 것 하나만** 반환한다:

1. `validateEmail(email)` → 실패 시 `{ ok: false, field: 'email', reason }`
2. `validatePassword(password)` → 실패 시 `{ ok: false, field: 'password', reason }`
3. `validatePasswordConfirm(password, confirm)` → 실패 시 `{ ok: false, field: 'confirm', reason }`

전부 통과하면 `{ ok: true }`.

인자가 객체가 아니면 `TypeError`. 필드가 없으면 `undefined` 가 각 검증기로 가서
`TypeError` 가 나는 게 맞다 — 삼키지 않는다.

## `src/lib/authMessages.js`

### `authErrorMessage(code)`

Firebase Auth 의 에러 코드 문자열을 한국어 문구로 바꾼다.

| 코드 | 반환 문구 |
|---|---|
| `'auth/email-already-in-use'` | `'이미 사용 중인 이메일입니다.'` |
| `'auth/credential-already-in-use'` | `'이미 사용 중인 이메일입니다.'` |
| `'auth/invalid-email'` | `'이메일 형식이 올바르지 않습니다.'` |
| `'auth/weak-password'` | `'비밀번호가 너무 짧습니다. 8자 이상으로 정해주세요.'` |
| `'auth/wrong-password'` | `'이메일 또는 비밀번호가 맞지 않습니다.'` |
| `'auth/user-not-found'` | `'이메일 또는 비밀번호가 맞지 않습니다.'` |
| `'auth/invalid-credential'` | `'이메일 또는 비밀번호가 맞지 않습니다.'` |
| `'auth/too-many-requests'` | `'시도가 너무 많습니다. 잠시 후 다시 해주세요.'` |
| `'auth/network-request-failed'` | `'네트워크에 연결할 수 없습니다.'` |
| `'auth/requires-recent-login'` | `'보안을 위해 다시 로그인한 뒤 시도해주세요.'` |
| `'auth/operation-not-allowed'` | `'이 로그인 방식이 꺼져 있습니다. 설정을 확인해주세요.'` |
| 그 외 / `null` / `undefined` / 빈 문자열 | ``'로그인 처리 중 문제가 생겼습니다. (' + String(code) + ')'`` |

**`wrong-password` 와 `user-not-found` 가 같은 문구인 건 의도다** — 어느 이메일이
가입돼 있는지 알려주지 않는다.

폴백에서 `code` 가 `null`/`undefined` 여도 `String(code)` 결과(`'null'`, `'undefined'`)를
그대로 넣는다. 값을 숨기지 않는다.

인자가 문자열도 `null`/`undefined` 도 아니면(숫자·객체 등) `TypeError` 를 던진다.

### `validationMessage(field, reason)`

`authValidation.js` 의 실패 결과를 문구로 바꾼다.

| field | reason | 반환 문구 |
|---|---|---|
| `'email'` | `'empty'` | `'이메일을 입력해주세요.'` |
| `'email'` | `'format'` | `'이메일 형식이 올바르지 않습니다.'` |
| `'email'` | `'tooLong'` | `'이메일이 너무 깁니다.'` |
| `'password'` | `'empty'` | `'비밀번호를 입력해주세요.'` |
| `'password'` | `'tooShort'` | `'비밀번호는 8자 이상이어야 합니다.'` |
| `'password'` | `'whitespaceOnly'` | `'비밀번호가 공백뿐입니다.'` |
| `'confirm'` | `'mismatch'` | `'비밀번호가 서로 다릅니다.'` |
| 조합이 표에 없음 | — | ``'입력을 확인해주세요. (' + String(field) + '/' + String(reason) + ')'`` |

## 테스트 요구사항

`tests/authValidation.test.js`, `tests/authMessages.test.js` 를 `node:test` 로 쓴다.

- **위 표의 모든 행을 테스트한다.** 표가 곧 명세다
- 경계값을 반드시 넣는다: 비밀번호 **7자/8자/9자**, 이메일 **255자/256자**
- `TypeError` 를 던지는 케이스도 `assert.throws` 로 잠근다
- 테스트는 **표에서 유도한다.** 구현을 읽고 베끼지 않는다

## 실행

```bash
npm test
```

실제 출력을 완료 보고에 붙인다.

## 하지 말 것

- 의존성 추가 금지
- Firebase SDK import 금지 (이 파일들은 순수하다)
- 표에 없는 검증 규칙을 지어내지 말 것 — 비었다고 판단되면 **채우지 말고 보고**한다
- 커밋하지 말 것. 파일만 남긴다
````

- [ ] **Step 2: `docs/NEXT.md` 「작업 분담 현황」에 한 줄 추가**

발주 전에 적는다. 같은 파일을 둘이 동시에 잡지 않기 위해서다.

```markdown
| `src/lib/authValidation.js`, `src/lib/authMessages.js` + 테스트 | **Codex** | 발주함 → `orders/08` |
```

- [ ] **Step 3: 발주 실행**

**워크스페이스 루트 절대경로로 부른다.** 이 셸은 명령 사이에 cwd 가 유지되므로,
직전에 `cd meal-calendar` 를 했으면 `scripts/` 상대경로를 못 찾는다.

```bash
/Users/jh/Desktop/claude/scripts/codex-order.sh meal-calendar docs/orders/08-auth-validation.md
```

스크립트가 실행 후 **실제 적용된 설정을 출력한다 — 그걸 확인한다.**
`model_reasoning_effort` 가 `high` 인지 본다. 기본값 `none` 으로 돌면 겉보기엔 정상인데
품질만 조용히 떨어진다.

- [ ] **Step 4: 발주가 도는 동안 Task 2 로 넘어간다**

Codex 를 기다리지 않는다. 리뷰는 Task 9 에서 한다.

---

### Task 2: `public/db.js` 인증 API 교체

**Files:**
- Modify: `public/db.js:8-10` (import), `public/db.js:28-46` (`signIn` 제거)

**Interfaces:**
- Consumes: 없음 (Firebase SDK 직접)
- Produces:
  ```js
  export function observeAuth(cb)      // cb(null | { uid, isAnonymous, email, emailVerified }) → unsubscribe 함수
  export function startGuest()         // → Promise<string> uid
  export function signUp(email, pw)    // → Promise<string> uid
  export function signInWithPassword(email, pw)  // → Promise<string> uid
  export function signOutUser()        // → Promise<void>
  export function resendVerification() // → Promise<void>
  export function sendReset(email)     // → Promise<void>
  export function hasAnyData()         // → Promise<boolean>
  export function countDays()          // → Promise<number>
  ```

- [ ] **Step 1: import 문 교체**

`public/db.js:8-10` 을 아래로 바꾼다.

```js
import {
  getAuth, signInAnonymously, onIdTokenChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  linkWithCredential, EmailAuthProvider,
  sendEmailVerification, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
```

`public/db.js:13` 의 firestore import 에 `limit` 을 추가한다 (`hasAnyData` 가 쓴다):

```js
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp,
  limit,
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
```

- [ ] **Step 2: `signIn()` 을 지우고 새 인증 블록으로 교체**

`public/db.js:28-46` 의 `signIn()` 전체를 지우고 그 자리에 아래를 넣는다.

```js
// ── 인증 ──────────────────────────────────────────────────────────────
// 상태는 「없음 / 비회원(익명) / 회원(이메일 링크됨)」 세 가지다.
// 비회원→회원은 linkWithCredential 이라 uid 가 유지된다 — 데이터가 한 바이트도 안 움직이고
// 보안 규칙도 그대로 성립한다. 설계는 docs/superpowers/specs/2026-08-13-auth-guest-member-design.md.

function snapshotUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    email: user.email,
    emailVerified: user.emailVerified,
  };
}

/** 인증 상태 구독. 로그인·로그아웃·링크 성공 때마다 불린다. 해지 함수를 돌려준다. */
export function observeAuth(cb) {
  return onIdTokenChanged(auth, (user) => cb(snapshotUser(user)));
}

/** 비회원으로 시작 — 익명 계정을 만든다. */
export async function startGuest() {
  const { user } = await signInAnonymously(auth);
  return user.uid;
}

/**
 * 회원가입.
 * - 비회원 사용 중이면 linkWithCredential → uid 유지, 데이터 유지
 * - 로그인 안 된 상태(게이트에서 바로 가입)면 새 계정 생성
 * 가입 직후 인증 메일을 보낸다. 메일 발송 실패는 가입 자체를 되돌리지 않는다 —
 * 계정은 이미 만들어졌고, 재발송 버튼이 설정 화면에 있다.
 */
export async function signUp(email, password) {
  const current = auth.currentUser;
  let user;

  if (current && current.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    ({ user } = await linkWithCredential(current, credential));
  } else {
    ({ user } = await createUserWithEmailAndPassword(auth, email, password));
  }

  try {
    await sendEmailVerification(user);
  } catch (err) {
    console.error('[meal-calendar] 인증 메일 발송 실패 — 설정에서 재발송할 수 있다', err);
  }
  return user.uid;
}

export async function signInWithPassword(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user.uid;
}

export function signOutUser() {
  return signOut(auth);
}

export function resendVerification() {
  const { currentUser } = auth;
  if (!currentUser) throw new Error('db: 로그인 상태가 아니다');
  return sendEmailVerification(currentUser);
}

export function sendReset(email) {
  return sendPasswordResetEmail(auth, email);
}

/**
 * 이 계정에 기록이 있나. 이메일 중복 충돌에서 「갈아타도 되는지」 판정에 쓴다.
 * 읽기 2회로 끝낸다 — goals·presets 는 따로 세지 않는다 (목표를 저장했으면 profile 이
 * 반드시 있고, 프리셋을 만들었으면 days 나 recentEntries 가 이미 차 있다).
 */
export async function hasAnyData() {
  const uid = requireUid();

  const userDoc = await getDoc(doc(db, 'users', uid));
  if (userDoc.exists()) {
    const data = userDoc.data();
    if (data.profile) return true;
    if (Array.isArray(data.recentEntries) && data.recentEntries.length > 0) return true;
  }

  const daysSnapshot = await getDocs(query(collection(db, 'users', uid, 'days'), limit(1)));
  return !daysSnapshot.empty;
}

/** 거부 문구에 「기록 N건」을 숫자로 박기 위해서다. 충돌 분기에서만 부른다. */
export async function countDays() {
  const snapshot = await getDocs(collection(db, 'users', requireUid(), 'days'));
  return snapshot.size;
}
```

- [ ] **Step 3: 구문 확인**

```bash
node --check public/db.js
```

Expected: 출력 없음 (통과)

> `public/db.js` 는 gstatic CDN 을 import 하므로 `node --check` 로 **구문만** 본다.
> 동작 검증은 Task 9 의 브라우저 실측에서 한다.

- [ ] **Step 4: `signIn` 잔존 호출 확인**

```bash
grep -rn "db\.signIn\|signIn()" public/ src/
```

Expected: `public/app.js:719` 한 곳만 나온다 (Task 5 에서 고친다). 다른 곳이 나오면 거기도 고친다.

---

### Task 3: 게이트 화면 마크업 + 스타일

**Files:**
- Modify: `public/index.html` — `<style>` 블록(12-299행) 안에 CSS 추가, `#settings` 시트(411행) **앞**에 게이트 시트 추가

**Interfaces:**
- Consumes: 없음
- Produces: DOM id — `authGate`, `guestStart`, `gateSignUpForm`, `gateSignInForm`, `gateError`, `gateTabSignUp`, `gateTabSignIn`, `gateForgot`

- [ ] **Step 1: CSS 추가**

`public/index.html` 의 `.manual-ratio` 규칙(218-221행) **바로 뒤**에 넣는다.

```css
  /* 인증 게이트 */
  .gate-hero { text-align: center; margin: 32px 0 24px; }
  .gate-hero h1 { font-size: 22px; margin: 0 0 8px; }
  .gate-hero p { font-size: 13px; color: var(--muted); margin: 0; line-height: 1.6; }
  .gate-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
  .gate-tabs button {
    flex: 1; -webkit-appearance: none; appearance: none;
    border: 1px solid var(--line); background: var(--card); color: var(--muted);
    border-radius: 10px; padding: 10px; font: inherit; font-weight: 600;
  }
  .gate-tabs button[aria-selected="true"] { color: var(--fg); border-color: var(--fg); }
  .gate-warn {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; font-size: 12px; color: var(--muted); line-height: 1.6;
    margin-bottom: 16px;
  }
  .gate-alt {
    margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line);
    text-align: center;
  }
  .gate-alt button {
    -webkit-appearance: none; appearance: none; border: 0; background: none;
    color: var(--muted); font: inherit; font-size: 13px; text-decoration: underline;
    padding: 6px;
  }
```

- [ ] **Step 2: 게이트 시트 마크업 추가**

`public/index.html:411` 의 `<div id="settings" class="sheet" hidden>` **바로 앞**에 넣는다.

**`autocomplete` 속성을 그대로 옮긴다 — 빠지면 iCloud 키체인이 비밀번호를 저장하지 않는다.**

```html
<div id="authGate" class="sheet" hidden>
  <div class="sheet-inner">
    <div class="gate-hero">
      <h1>식단 캘린더</h1>
      <p>기록을 어디에 남길지 정해주세요.</p>
    </div>

    <div class="gate-tabs" role="tablist">
      <button type="button" id="gateTabSignUp" role="tab" aria-selected="true">회원가입</button>
      <button type="button" id="gateTabSignIn" role="tab" aria-selected="false">로그인</button>
    </div>

    <div id="gateError" class="form-error" hidden></div>

    <form id="gateSignUpForm" class="profile-form">
      <label>이메일
        <input name="email" type="email" autocomplete="username"
               inputmode="email" autocapitalize="none" spellcheck="false" required>
      </label>
      <label>비밀번호 (8자 이상)
        <input name="password" type="password" autocomplete="new-password" required>
      </label>
      <label>비밀번호 확인
        <input name="confirm" type="password" autocomplete="new-password" required>
      </label>
      <button type="submit">회원가입</button>
    </form>

    <form id="gateSignInForm" class="profile-form" hidden>
      <label>이메일
        <input name="email" type="email" autocomplete="username"
               inputmode="email" autocapitalize="none" spellcheck="false" required>
      </label>
      <label>비밀번호
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">로그인</button>
      <button type="button" id="gateForgot" class="link-button">비밀번호를 잊었어요</button>
    </form>

    <div class="gate-alt">
      <div class="gate-warn">
        비회원으로도 쓸 수 있습니다. 다만 <b>앱을 지우면 기록이 사라집니다.</b>
        나중에 설정에서 회원으로 바꾸면 기록은 그대로 이어집니다.
      </div>
      <button type="button" id="guestStart">비회원으로 시작</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: `.link-button` 스타일 추가**

Step 1 에서 넣은 CSS 블록 끝에 이어 붙인다.

```css
  .link-button {
    -webkit-appearance: none; appearance: none; border: 0; background: none;
    color: var(--muted); font: inherit; font-size: 13px; text-decoration: underline;
    padding: 6px 0; text-align: left;
  }
```

- [ ] **Step 4: 마크업 확인**

```bash
grep -c 'id="authGate"\|id="guestStart"\|id="gateSignUpForm"\|id="gateSignInForm"\|id="gateError"\|id="gateTabSignUp"\|id="gateTabSignIn"\|id="gateForgot"' public/index.html
```

Expected: `8`

---

### Task 4: 설정 계정 섹션 마크업

**Files:**
- Modify: `public/index.html` — `#settings` 시트 안, `#manualRatio`(417행) **앞**에 계정 섹션 추가

**Interfaces:**
- Consumes: Task 3 의 `.gate-warn`, `.link-button` CSS
- Produces: DOM id — `accountSection`, `accountGuest`, `accountMember`, `accountEmail`, `verifyWarn`, `resendVerify`, `upgradeForm`, `upgradeError`, `signOutBtn`, `switchAccountBtn`, `conflictPrompt`, `conflictText`, `conflictAbandon`, `conflictCancel`

- [ ] **Step 1: 계정 섹션 CSS 추가**

Task 3 Step 3 의 `.link-button` 뒤에 이어 붙인다.

```css
  /* 설정 > 계정 */
  .account-box {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px; margin-bottom: 16px;
  }
  .account-box h3 { font-size: 13px; margin: 0 0 10px; }
  .account-mail { font-size: 14px; font-weight: 600; margin: 0 0 8px; word-break: break-all; }
  .account-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
```

- [ ] **Step 2: 계정 섹션 마크업 추가**

`public/index.html:417` 의 `<div id="manualRatio" ...>` **바로 앞**에 넣는다.

```html
<section id="accountSection" class="account-box">
  <h3>계정</h3>

  <div id="accountGuest" hidden>
    <div class="gate-warn">
      ⚠ 비회원입니다. <b>앱을 지우면 기록이 사라집니다.</b>
      회원으로 바꾸면 지금 기록이 그대로 이어집니다.
    </div>
    <div id="upgradeError" class="form-error" hidden></div>
    <form id="upgradeForm" class="profile-form">
      <label>이메일
        <input name="email" type="email" autocomplete="username"
               inputmode="email" autocapitalize="none" spellcheck="false" required>
      </label>
      <label>비밀번호 (8자 이상)
        <input name="password" type="password" autocomplete="new-password" required>
      </label>
      <label>비밀번호 확인
        <input name="confirm" type="password" autocomplete="new-password" required>
      </label>
      <button type="submit">회원 전환</button>
    </form>
    <div class="account-actions">
      <button type="button" id="switchAccountBtn" class="link-button">다른 계정으로 로그인</button>
    </div>
  </div>

  <div id="accountMember" hidden>
    <p id="accountEmail" class="account-mail"></p>
    <div id="verifyWarn" class="gate-warn" hidden>
      ⚠ 이메일 미인증 — 지금 비밀번호를 잊으면 복구할 수 없습니다.
    </div>
    <div class="account-actions">
      <button type="button" id="resendVerify" class="link-button" hidden>인증 메일 다시 보내기</button>
      <button type="button" id="signOutBtn" class="link-button">로그아웃</button>
    </div>
  </div>

  <div id="conflictPrompt" hidden>
    <div class="form-error" id="conflictText"></div>
    <div class="account-actions">
      <button type="button" id="conflictCancel" class="link-button">다른 이메일 쓰기</button>
      <button type="button" id="conflictAbandon" class="link-button">기록을 포기하고 그 계정으로 로그인</button>
    </div>
  </div>
</section>
```

> **비회원 블록에 로그아웃 버튼이 없다. 의도다.** 익명 로그아웃은 기록 영구 소실이고
> 되돌릴 방법이 없다. 계정을 바꿀 길은 `#switchAccountBtn` 하나뿐이고, 그건 2단계 확인을 거친다.

- [ ] **Step 3: 마크업 확인**

```bash
grep -c 'id="accountSection"\|id="accountGuest"\|id="accountMember"\|id="accountEmail"\|id="verifyWarn"\|id="resendVerify"\|id="upgradeForm"\|id="upgradeError"\|id="signOutBtn"\|id="switchAccountBtn"\|id="conflictPrompt"\|id="conflictText"\|id="conflictAbandon"\|id="conflictCancel"' public/index.html
```

Expected: `14`

- [ ] **Step 4: 비회원 로그아웃 버튼이 없는지 확인**

```bash
awk '/id="accountGuest"/,/id="accountMember"/' public/index.html | grep -c "signOutBtn"
```

Expected: `0`

---

### Task 5: `app.js` — 인증 상태 전환

**Files:**
- Modify: `public/app.js:1-4` (import), `public/app.js:56-80` 부근 (`el` 객체), `public/app.js:714-737` (`start()`)

**Interfaces:**
- Consumes: Task 1 의 `validateSignUpForm`/`authErrorMessage`/`validationMessage`, Task 2 의 `observeAuth`/`startGuest` 등, Task 3·4 의 DOM id
- Produces: `applyAuthState(user)` — `observeAuth` 콜백. `state.auth` 에 현재 상태 보관

- [ ] **Step 1: import 추가**

`public/app.js:4` (`import { scaleNutrients } ...`) 다음 줄에 넣는다.

```js
import { validateSignUpForm } from '/src/lib/authValidation.js';
import { authErrorMessage, validationMessage } from '/src/lib/authMessages.js';
```

- [ ] **Step 2: `state` 에 필드 추가**

`public/app.js` 의 `const state = {` 블록에서 `pendingSlot: null,` 다음 줄에 넣는다.

```js
  auth: null, // null | { uid, isAnonymous, email, emailVerified }
  booted: false, // 데이터 로딩을 한 번만 돌리기 위한 래치
```

- [ ] **Step 3: `el` 에 DOM 참조 추가**

`public/app.js` 의 `const el = {` 블록 끝(마지막 항목 뒤)에 넣는다.

```js
  authGate: document.getElementById('authGate'),
  guestStart: document.getElementById('guestStart'),
  gateSignUpForm: document.getElementById('gateSignUpForm'),
  gateSignInForm: document.getElementById('gateSignInForm'),
  gateError: document.getElementById('gateError'),
  gateTabSignUp: document.getElementById('gateTabSignUp'),
  gateTabSignIn: document.getElementById('gateTabSignIn'),
  gateForgot: document.getElementById('gateForgot'),
  accountGuest: document.getElementById('accountGuest'),
  accountMember: document.getElementById('accountMember'),
  accountEmail: document.getElementById('accountEmail'),
  verifyWarn: document.getElementById('verifyWarn'),
  resendVerify: document.getElementById('resendVerify'),
  upgradeForm: document.getElementById('upgradeForm'),
  upgradeError: document.getElementById('upgradeError'),
  signOutBtn: document.getElementById('signOutBtn'),
  switchAccountBtn: document.getElementById('switchAccountBtn'),
  conflictPrompt: document.getElementById('conflictPrompt'),
  conflictText: document.getElementById('conflictText'),
  conflictAbandon: document.getElementById('conflictAbandon'),
  conflictCancel: document.getElementById('conflictCancel'),
```

- [ ] **Step 4: 인증 블록 추가**

`public/app.js` 의 `// ── Phase 2 → 3 이관 ───` 주석(686행) **바로 앞**에 넣는다.

```js
// ── 인증 ──────────────────────────────────────────────────────────────
// observeAuth 콜백 하나가 게이트↔캘린더 전환과 설정 계정 섹션을 동시에 담당한다.
// 화면 상태를 두 군데서 따로 계산하면 어긋난다.

function showAuthError(target, message) {
  target.hidden = false;
  target.textContent = message;
}

function clearAuthError(target) {
  target.hidden = true;
  target.textContent = '';
}

/** 폼 검증 → 실패하면 문구를 띄우고 null 을 돌려준다. */
function readCredentialForm(form, errorBox) {
  const data = new FormData(form);
  const fields = {
    email: String(data.get('email') ?? '').trim(),
    password: String(data.get('password') ?? ''),
    confirm: String(data.get('confirm') ?? ''),
  };

  const verdict = validateSignUpForm(fields);
  if (!verdict.ok) {
    showAuthError(errorBox, validationMessage(verdict.field, verdict.reason));
    return null;
  }
  clearAuthError(errorBox);
  return fields;
}

function renderAccountSection(user) {
  el.conflictPrompt.hidden = true;

  if (!user) {
    el.accountGuest.hidden = true;
    el.accountMember.hidden = true;
    return;
  }

  el.accountGuest.hidden = !user.isAnonymous;
  el.accountMember.hidden = user.isAnonymous;

  if (!user.isAnonymous) {
    el.accountEmail.textContent = user.email ?? '(이메일 없음)';
    el.verifyWarn.hidden = user.emailVerified;
    el.resendVerify.hidden = user.emailVerified;
  }
}

/**
 * 인증 상태가 바뀔 때마다 불린다.
 * user 가 있으면 게이트를 숨기고, 아직 데이터를 안 읽었으면 그때 읽는다.
 * booted 래치가 없으면 이메일 인증 상태 갱신 같은 사소한 변화마다 한 달치를 다시 읽는다.
 */
async function applyAuthState(user) {
  state.auth = user;
  renderAccountSection(user);

  if (!user) {
    el.authGate.hidden = false;
    state.booted = false;
    return;
  }

  el.authGate.hidden = true;
  if (state.booted) return;
  state.booted = true;

  await migrateLegacyProfile();

  try {
    state.goal = await db.loadGoalFor(todayLocalDate());
  } catch (err) {
    console.error('[meal-calendar] 목표 조회 실패', err);
  }

  await loadMonthData();
}
```

- [ ] **Step 5: `start()` 교체**

`public/app.js:714-737` 의 `start()` 함수 전체와 `start();` 호출을 아래로 바꾼다.

```js
async function start() {
  renderMonth(); // Firebase 도착 전에도 그리드부터 그린다 — 이게 이 함수의 핵심이다
  await dbReady;

  bindAuthHandlers();

  // 로그인 상태를 아직 모르는 동안에는 게이트를 띄우지 않는다 —
  // 띄웠다가 곧바로 숨기면 기존 사용자에게 로그인 화면이 깜빡인다.
  db.observeAuth((user) => {
    applyAuthState(user).catch((err) => {
      console.error('[meal-calendar] 인증 상태 처리 실패', err);
      setSaveState('failed', '초기화 실패 — 새로고침해주세요.');
    });
  });
}

start();
```

- [ ] **Step 6: 구문 확인**

```bash
node --check public/app.js
```

Expected: `bindAuthHandlers` 는 Task 6 에서 정의한다. `node --check` 는 구문만 보므로
**이 단계에서는 통과한다.** 통과하지 않으면 위 편집에 구문 오류가 있는 것이다.

---

### Task 6: `app.js` — 게이트/가입/로그인 핸들러

**Files:**
- Modify: `public/app.js` — Task 5 에서 넣은 인증 블록 끝에 이어 붙인다

**Interfaces:**
- Consumes: Task 5 의 `readCredentialForm`, `showAuthError`, `clearAuthError`
- Produces: `bindAuthHandlers()` — Task 5 Step 5 의 `start()` 가 부른다

- [ ] **Step 1: 핸들러 블록 추가**

Task 5 Step 4 에서 넣은 `applyAuthState` **바로 뒤**에 이어 붙인다.

```js
function selectGateTab(mode) {
  const isSignUp = mode === 'signup';
  el.gateTabSignUp.setAttribute('aria-selected', String(isSignUp));
  el.gateTabSignIn.setAttribute('aria-selected', String(!isSignUp));
  el.gateSignUpForm.hidden = !isSignUp;
  el.gateSignInForm.hidden = isSignUp;
  clearAuthError(el.gateError);
}

/**
 * 버튼을 잠그고 작업을 돌린다. 실패하면 문구를 띄운다 — 조용히 삼키지 않는다 (절대규칙 7).
 *
 * **주의:** 성공하면 errorBox 를 비우고 버튼 라벨을 원래대로 되돌린다.
 * 그러니 성공 안내 문구나 라벨 변경은 `action` **안에서 하지 말고**
 * 이 함수가 resolve 된 뒤에 한다 — 안에서 하면 여기서 덮어쓴다.
 */
async function runAuthAction(button, errorBox, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '처리 중…';
  try {
    await action();
    clearAuthError(errorBox);
  } catch (err) {
    console.error('[meal-calendar] 인증 실패', err);
    showAuthError(errorBox, authErrorMessage(err?.code));
    throw err;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function bindAuthHandlers() {
  el.gateTabSignUp.addEventListener('click', () => selectGateTab('signup'));
  el.gateTabSignIn.addEventListener('click', () => selectGateTab('signin'));

  el.guestStart.addEventListener('click', () => {
    runAuthAction(el.guestStart, el.gateError, () => db.startGuest()).catch(() => {});
  });

  el.gateSignUpForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = readCredentialForm(el.gateSignUpForm, el.gateError);
    if (!fields) return;
    const button = el.gateSignUpForm.querySelector('button[type="submit"]');
    runAuthAction(button, el.gateError, () => db.signUp(fields.email, fields.password))
      .catch(() => {});
  });

  el.gateSignInForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(el.gateSignInForm);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (!email || !password) {
      showAuthError(el.gateError, '이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }
    const button = el.gateSignInForm.querySelector('button[type="submit"]');
    runAuthAction(button, el.gateError, () => db.signInWithPassword(email, password))
      .catch(() => {});
  });

  el.gateForgot.addEventListener('click', () => {
    const email = String(new FormData(el.gateSignInForm).get('email') ?? '').trim();
    if (!email) {
      showAuthError(el.gateError, '재설정 메일을 받을 이메일을 먼저 입력해주세요.');
      return;
    }
    // 성공 문구는 runAuthAction 밖에서 띄운다 — 안에서 띄우면 성공 직후 clearAuthError 가 지운다
    runAuthAction(el.gateForgot, el.gateError, () => db.sendReset(email))
      .then(() => showAuthError(el.gateError, `${email} 로 재설정 메일을 보냈습니다.`))
      .catch(() => {});
  });

  el.resendVerify.addEventListener('click', () => {
    runAuthAction(el.resendVerify, el.upgradeError, () => db.resendVerification())
      .then(() => showAuthError(el.upgradeError, '인증 메일을 다시 보냈습니다.'))
      .catch(() => {});
  });

  el.signOutBtn.addEventListener('click', () => {
    runAuthAction(el.signOutBtn, el.upgradeError, () => db.signOutUser()).catch(() => {});
  });

  bindUpgradeHandlers();
}
```

- [ ] **Step 2: 구문 확인**

```bash
node --check public/app.js
```

Expected: 출력 없음 (`bindUpgradeHandlers` 는 Task 7 에서 정의한다 — 구문 검사는 통과한다)

---

### Task 7: `app.js` — 회원 전환 + 이메일 중복 충돌

**Files:**
- Modify: `public/app.js` — Task 6 의 `bindAuthHandlers` **뒤**에 이어 붙인다

**Interfaces:**
- Consumes: Task 2 의 `hasAnyData`/`countDays`/`signUp`/`signInWithPassword`
- Produces: `bindUpgradeHandlers()` — Task 6 의 `bindAuthHandlers()` 가 부른다

- [ ] **Step 1: 충돌 처리 블록 추가**

```js
// 이메일이 이미 다른 계정에 쓰이고 있을 때 쓰는 보류 상태.
// 「기록을 포기하고 그 계정으로 로그인」을 눌렀을 때 어떤 자격으로 갈지 기억한다.
let pendingConflict = null;

const IN_USE_CODES = new Set([
  'auth/email-already-in-use',
  'auth/credential-already-in-use',
]);

/**
 * 중복 이메일 충돌 처리.
 * - 현재 익명 계정이 비어 있으면 손실이 없으므로 곧바로 갈아탄다
 * - 기록이 있으면 멈추고 「몇 건이 넘어가지 않는지」를 숫자로 보여준다 (절대규칙 7)
 */
async function handleEmailInUse(email, password) {
  if (!(await db.hasAnyData())) {
    await db.signInWithPassword(email, password);
    return;
  }

  const dayCount = await db.countDays();
  pendingConflict = { email, password };
  el.conflictText.textContent =
    `이 이메일은 이미 다른 계정에 쓰이고 있습니다. `
    + `이 기기의 기록 ${dayCount}일치는 그 계정으로 넘어가지 않고 사라집니다.`;
  el.conflictPrompt.hidden = false;
  el.upgradeForm.hidden = true;
}

function cancelConflict() {
  pendingConflict = null;
  el.conflictPrompt.hidden = true;
  el.upgradeForm.hidden = false;
  clearAuthError(el.upgradeError);
}

function bindUpgradeHandlers() {
  el.upgradeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = readCredentialForm(el.upgradeForm, el.upgradeError);
    if (!fields) return;

    const button = el.upgradeForm.querySelector('button[type="submit"]');
    runAuthAction(button, el.upgradeError, async () => {
      try {
        await db.signUp(fields.email, fields.password);
      } catch (err) {
        if (!IN_USE_CODES.has(err?.code)) throw err;
        await handleEmailInUse(fields.email, fields.password);
      }
    }).catch(() => {});
  });

  el.conflictCancel.addEventListener('click', cancelConflict);

  // 2단계 확인. 첫 탭에서는 문구만 바꾸고, 같은 버튼을 한 번 더 눌러야 실행된다.
  el.conflictAbandon.addEventListener('click', () => {
    if (el.conflictAbandon.dataset.armed !== 'yes') {
      el.conflictAbandon.dataset.armed = 'yes';
      el.conflictAbandon.textContent = '정말 포기합니다 — 한 번 더 누르세요';
      return;
    }
    const credential = pendingConflict;
    if (!credential) return;
    // 라벨 되돌리기도 runAuthAction 밖에서 한다 — finally 가 '무장된' 라벨로 복원해버린다
    runAuthAction(el.conflictAbandon, el.upgradeError, async () => {
      await db.signOutUser();
      await db.signInWithPassword(credential.email, credential.password);
    }).then(() => {
      pendingConflict = null;
      el.conflictAbandon.dataset.armed = '';
      el.conflictAbandon.textContent = '기록을 포기하고 그 계정으로 로그인';
    }).catch(() => {});
  });

  // 비회원 상태에서 「다른 계정으로 로그인」 — 게이트로 돌아가되 익명 세션을 버린다.
  // 이것도 2단계다. 익명 계정은 로그아웃하면 되찾을 수 없다.
  el.switchAccountBtn.addEventListener('click', () => {
    if (el.switchAccountBtn.dataset.armed !== 'yes') {
      el.switchAccountBtn.dataset.armed = 'yes';
      el.switchAccountBtn.textContent = '지금 기록이 사라집니다 — 한 번 더 누르세요';
      return;
    }
    runAuthAction(el.switchAccountBtn, el.upgradeError, () => db.signOutUser())
      .then(() => {
        el.switchAccountBtn.dataset.armed = '';
        el.switchAccountBtn.textContent = '다른 계정으로 로그인';
        closeSettings();
      })
      .catch(() => {});
  });
}
```

- [ ] **Step 2: `closeSettings` 이름 확인**

Step 1 의 마지막에서 `closeSettings()` 를 부른다. 실제 함수명이 다르면 맞춘다.

```bash
grep -n "function closeSettings\|closeSettings\b" public/app.js
```

Expected: `function closeSettings` 정의가 나온다. 이름이 다르면(예: `hideSettings`) Step 1 코드를 그 이름으로 고친다.

- [ ] **Step 3: 구문 확인**

```bash
node --check public/app.js
```

Expected: 출력 없음

- [ ] **Step 4: 미정의 참조 확인**

```bash
grep -n "bindAuthHandlers\|bindUpgradeHandlers\|applyAuthState\|runAuthAction\|readCredentialForm" public/app.js
```

Expected: 각 이름이 **정의 1회 + 호출 1회 이상**으로 나온다. 호출만 있고 정의가 없는 이름이 있으면 안 된다.

---

### Task 8: Codex 산출물 리뷰

Task 1 의 발주 결과를 받는다. `../AGENTS.md` 「리뷰 방법 — 로그를 읽지 않는다」를 따른다.
**Codex 실행 로그를 열지 않는다.** 앞 단계에서 걸리면 뒤로 가지 않는다.

**Files:**
- Read: `src/lib/authValidation.js`, `src/lib/authMessages.js`

- [ ] **Step 1: 테스트를 직접 돌린다**

```bash
npm test
```

Expected: 전부 통과. **실패하면 여기서 끝이다** — 코드를 읽지 말고 실패 출력만 Codex 에 돌려보낸다.

- [ ] **Step 2: 발주 범위 밖 파일이 바뀌지 않았나**

```bash
git status --short && git diff --stat
```

Expected: `src/lib/authValidation.js`, `src/lib/authMessages.js`, `tests/authValidation.test.js`,
`tests/authMessages.test.js` 만 새로 생겼다. 기존 파일이 바뀌었으면 왜인지 확인한다.

- [ ] **Step 3: 구현 파일만 읽는다 (테스트 파일은 아직 안 읽는다)**

`src/lib/authValidation.js`, `src/lib/authMessages.js` 를 읽고 발주서 표와 대조한다.
확인할 것: 최소 길이가 8인가 / 이메일은 trim 하고 비밀번호는 trim 하지 않는가 /
`wrong-password` 와 `user-not-found` 가 같은 문구인가 / 폴백이 코드 값을 그대로 노출하는가.

- [ ] **Step 4: 테스트가 명세 항목을 실제로 덮는지 이름만 대조**

```bash
grep -c "^test(\|  test(\|it(" tests/authValidation.test.js tests/authMessages.test.js
grep -o "test('[^']*'" tests/authValidation.test.js tests/authMessages.test.js
```

발주서 표의 행 수와 견준다. 경계값(비밀번호 7/8/9자, 이메일 255/256자)이 이름에 보여야 한다.

- [ ] **Step 5: 구현을 일부러 깨뜨려 테스트가 잡는지 확인**

`src/lib/authValidation.js` 의 `MIN_PASSWORD_LENGTH` 를 `8` → `7` 로 바꾼다.

```bash
npm test
```

Expected: **실패한다.** 통과하면 그 테스트는 가짜다 — 경계값 테스트가 없다는 뜻이므로 반려한다.
확인 후 `8` 로 되돌린다.

```bash
npm test
```

Expected: 다시 전부 통과

- [ ] **Step 6: `docs/NEXT.md` 「Codex 발주 대기열」 갱신**

발주 08 행을 추가하고 「명세 준비 / 발주 / 내 리뷰」를 체크한다.
**사용자 컨펌 칸은 비워둔다** — 그건 사용자가 한다.

---

### Task 9: 브라우저 실측 검증

**"될 것이다"는 검증이 아니다.** 실제로 열어서 확인한다.

**Files:** 없음 (검증만)

- [ ] **Step 1: 로컬에서 띄운다**

```bash
firebase serve --only hosting
```

또는 배포한다 (사용자 요청 시에만):

```bash
firebase deploy --only hosting
```

- [ ] **Step 2: 기존 익명 세션이 안 깨지는지 — 제일 먼저 본다**

이미 로그인된 브라우저에서 앱을 연다.

Expected: **게이트가 뜨지 않는다.** 캘린더가 바로 보이고 기존 기록이 그대로 있다.
게이트가 깜빡이면 Task 5 Step 5 의 「상태를 모르는 동안 게이트를 안 띄운다」가 깨진 것이다.

- [ ] **Step 3: 게이트 — 새 세션**

시크릿 창(또는 저장소 비운 프로필)에서 연다.

Expected: 게이트가 뜬다. 「회원가입 / 로그인」 탭이 전환된다. 「비회원으로 시작」이 보인다.

- [ ] **Step 4: 비회원 → 기록 → 회원 전환 → uid 유지 확인**

1. 「비회원으로 시작」
2. 아무 날짜에 항목 하나 추가
3. 설정 → 계정 → 이메일/비밀번호 입력 → 「회원 전환」
4. **추가한 기록이 그대로 보이는지 확인** ← 이게 이 기능의 존재 이유다

Expected: 기록 유지. 콘솔에서 uid 가 전환 전후로 같은지 확인한다.

- [ ] **Step 5: 로그아웃 → 재로그인 → 기록 유지**

설정 → 로그아웃 → 게이트 → 로그인 탭 → 같은 이메일/비밀번호

Expected: Step 4 에서 추가한 기록이 그대로 보인다.

- [ ] **Step 6: 미인증 경고**

설정 → 계정

Expected: 「⚠ 이메일 미인증」이 보이고 「인증 메일 다시 보내기」 버튼이 있다.
인증 메일을 실제로 받아 클릭한 뒤 앱을 새로고침하면 경고가 사라져야 한다.

- [ ] **Step 7: 비회원에 로그아웃 버튼이 없는지**

시크릿 창 → 비회원으로 시작 → 설정 → 계정

Expected: 로그아웃 버튼 없음. 「다른 계정으로 로그인」만 있고, 한 번 누르면
「지금 기록이 사라집니다 — 한 번 더 누르세요」로 바뀐다.

- [ ] **Step 8: 이메일 중복 거부**

비회원으로 시작 → 항목 하나 추가 → 설정 → **Step 4 에서 쓴 이메일**로 회원 전환 시도

Expected: 「이 이메일은 이미 다른 계정에 쓰이고 있습니다. 이 기기의 기록 **1일치**는
그 계정으로 넘어가지 않고 사라집니다.」 — **숫자가 실제 값으로 찍혀야 한다.**
「다른 이메일 쓰기」를 누르면 폼으로 돌아온다.

- [ ] **Step 9: 검증 결과를 기록한다**

실행한 것과 실제로 본 것을 적는다. 못 해본 항목은 「확인 못 함」으로 남긴다.
**추측으로 채우지 않는다.**

---

### Task 10: 문서 갱신

**Files:**
- Modify: `docs/ARCHITECTURE.md:100-102`
- Modify: `docs/NEXT.md`

- [ ] **Step 1: `docs/ARCHITECTURE.md` 의 이메일 링크 전제 교체**

100-102행의 아래 문단을

```
익명 인증을 쓰되 **계정 복구 경로를 만든다** — 익명 uid는 앱 삭제 시 사라진다.
나중에 이메일 링크로 승격(`linkWithCredential`)할 수 있게 설계해 둔다. **아직 안 만들었다 —
지금 앱을 지우면 기록이 사라집니다.** Phase 5 전에 붙여야 한다.
```

아래로 바꾼다.

```markdown
### 계정 복구 — 비회원/회원 (2026-08-13 구현)

익명 uid 는 앱 삭제 시 사라진다. 그래서 「비회원 / 회원」 두 갈래로 나눈다.

- **비회원** = 익명 로그인. 지금까지와 같다
- **회원** = 그 익명 uid 에 이메일+비밀번호를 `linkWithCredential` 로 붙인 것.
  **uid 가 유지되므로 Firestore 데이터 이동이 없고 보안 규칙도 그대로다**

**이메일 링크(패스워드리스) 방식은 폐기했다.** iOS standalone PWA 에서 성립하지 않는다 —
메일의 링크를 탭하면 홈 화면 PWA 가 아니라 Safari 가 열리고, 둘은 저장소 컨텍스트가
분리돼 있어서 Safari 쪽에는 승격시킬 익명 uid 자체가 없다. 링크는 성공한 것처럼 보이는데
PWA 의 기록만 고아가 된다.

설계 전문: `docs/superpowers/specs/2026-08-13-auth-guest-member-design.md`
```

- [ ] **Step 2: `docs/NEXT.md` 「지금 상태」에 항목 추가**

맨 위 「지금 상태」 블록에 넣는다.

```markdown
**계정 복구 완료 (2026-08-13).** 비회원(익명)/회원(이메일+비밀번호) 분리.
`linkWithCredential` 로 승격해서 **uid 유지 → 데이터 이동 0, 보안 규칙 수정 0**.
게이트 화면 + 설정 계정 섹션 + 이메일 중복 충돌 처리(기록 건수를 숫자로 표시하고 2단계 확인).
이메일 인증은 강제하지 않고 미인증 경고를 상주시킨다.
```

- [ ] **Step 3: `docs/NEXT.md` 「남은 구멍」에서 해당 줄 삭제**

```
**남은 구멍:** 익명 계정 복구 경로가 없다 — **앱을 지우면 기록이 사라집니다.** Phase 5 전에 붙여야 한다.
```

이 줄을 지운다. 해소됐다.

- [ ] **Step 4: `docs/NEXT.md` 「작업 분담 현황」 갱신**

Task 1 Step 2 에서 넣은 Codex 행의 상태를 리뷰 결과로 바꾸고,
Claude 담당 행(`public/db.js`, `index.html`, `app.js`)을 추가한다.

- [ ] **Step 5: 「확인 안 된 가설」에 캐시 항목 추가**

```markdown
- 로그아웃 후 다른 계정으로 로그인했을 때 Firestore 오프라인 캐시(IndexedDB)에 이전 uid 의
  데이터가 남는지 → **미검증.** 보안 규칙상 서버 읽기는 막히지만 로컬 잔존 여부는 확인 안 함
```

---

## 완료 조건

- [ ] `npm test` 전부 통과
- [ ] Task 9 의 8개 실측 항목 전부 확인 (못 한 것은 「확인 못 함」으로 명시)
- [ ] 문서 3개 갱신 (`ARCHITECTURE.md`, `NEXT.md`, 발주 대기열)
- [ ] **사용자 컨펌** ← 이거 없이 머지하지 않는다
