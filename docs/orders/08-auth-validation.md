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
