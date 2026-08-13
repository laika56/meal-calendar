# 비회원/회원 인증 — 설계

작성: 2026-08-13
상태: 승인됨 (사용자 컨펌 완료)

## 왜 하는가

지금 앱은 익명 로그인만 쓴다. **앱을 지우면 익명 uid가 사라지고 기록이 영구 소실된다.**
복구 경로가 없다. Phase 5(체중 추이) 전에 붙여야 한다 — 추이는 과거 데이터가 살아 있어야 성립한다.

## 원래 문서 전제를 뒤집은 것

`docs/ARCHITECTURE.md:101` 은 "이메일 **링크**로 승격(`linkWithCredential`)" 이라 적혀 있었다.
**iOS standalone PWA 에서 성립하지 않는다:**

- 메일 앱에서 링크를 탭하면 **Safari 가 열린다.** 홈 화면 PWA 가 아니다
- standalone PWA 와 Safari 는 **저장소 컨텍스트가 분리**돼 있다 (IndexedDB/localStorage 별개)
- 따라서 Safari 쪽에는 PWA 의 익명 uid 가 없다 → `linkWithCredential` 이 **승격시킬 대상이 없다**
- 링크 자체는 성공한 것처럼 보이는데 PWA 의 기록은 그대로 고아가 된다

→ **이메일 + 비밀번호**로 확정. 앱 밖으로 나가지 않으므로 저장소 분리 문제가 발생하지 않는다.

`docs/ARCHITECTURE.md` 의 해당 문단을 이 결정으로 갱신한다.

### 검토했지만 탈락한 것

| 방식 | 탈락 사유 |
|---|---|
| 구글 로그인 | `signInWithPopup` 이 standalone 에서 막힌다. `signInWithRedirect` 는 Safari ITP 때문에 `authDomain` 을 자체 도메인(`calorie-43692.web.app`)으로 맞춰야 살아난다 — **미검증**. 작업량과 위험이 둘 다 늘어난다 |
| 애플 로그인 | Apple Developer Program($99/년) 필요. "애플 개발자 계정 없이"가 프로젝트 전제다 |
| 패스키(WebAuthn) | UX 는 최고(Face ID, iCloud 동기화, 재설치 생존)지만 **Firebase Auth 가 네이티브 지원하지 않는다.** Cloud Function 에서 WebAuthn 검증 + custom token 발급을 직접 구현해야 하고 의존성 추가가 필요하다. 단계 하나가 아니라 별도 프로젝트 규모 |

## 인증 상태 3가지

| 상태 | 내부 동작 | 데이터 경로 |
|---|---|---|
| **없음** | 로그인 안 됨 | — (게이트 화면) |
| **비회원** | `signInAnonymously` | `users/{익명uid}/…` |
| **회원** | 익명 uid 에 이메일 자격이 링크됨 | `users/{같은 uid}/…` |

**`linkWithCredential` 은 새 계정을 만들지 않는다.** 기존 익명 계정에 로그인 수단을 붙인다.
그래서 uid 가 그대로고, **Firestore 데이터 이동이 0이며, 보안 규칙 수정이 필요 없다.**

## 화면 흐름

```
앱 로드 → onIdTokenChanged
   │
   ├─ user 있음 ────────────► 캘린더 (게이트 안 뜸)
   │
   └─ user 없음 ────────────► 게이트
                              ├ [비회원으로 시작]  ⚠ 앱 지우면 기록 사라짐
                              ├ [회원가입]
                              └ [로그인]
```

**기존 익명 세션은 게이트를 보지 않는다.** 이미 로그인된 상태이므로 바로 캘린더로 간다 —
지금 쓰고 있는 기록이 그대로 유지된다. 게이트는 재설치·새 기기에서만 등장한다.

## 설정 > 계정 섹션

상태별로 다른 것을 보여준다.

**비회원**
```
⚠ 비회원 — 앱을 지우면 기록이 사라집니다
  이메일   [ autocomplete=username     ]
  비밀번호 [ autocomplete=new-password ]
  비밀번호 확인
  [회원 전환]
  ───────────
  [다른 계정으로 로그인]
```

**회원 · 미인증**
```
you@example.com
⚠ 이메일 미인증 — 지금 비밀번호를 잊으면 복구할 수 없습니다
[인증 메일 다시 보내기]
[로그아웃]
```

**회원 · 인증됨**
```
you@example.com ✓
[로그아웃]
```

### 비회원에게 로그아웃 버튼을 주지 않는다

익명 계정 로그아웃은 **기록 영구 소실**이고 되돌릴 방법이 없다.
"다른 계정으로 로그인"만 두되, 현재 기기 기록이 **몇 건인지 숫자로 명시**하고
2단계 확인을 거친 뒤에 진행한다 (절대규칙 7 — 조용히 뭉개지 않는다).

## 이메일 인증 정책

**가입 즉시 사용 가능. 인증은 강제하지 않되 미인증 경고를 상주시킨다.**

이유: 이 기능의 목적이 복구인데, 오타 이메일(`gmial.com`)로 가입하면 가입은 성공하고
비밀번호 재설정 메일만 존재하지 않는 주소로 간다 → **영구 잠김.**
복구하려고 만든 기능이 조용히 실패하는 것이라 절대규칙 7 위반이다.

- 가입 직후 `sendEmailVerification` 발송
- `emailVerified === false` 인 동안 설정 화면에 경고 상주 + 재발송 버튼
- 앱 기능은 막지 않는다 (메일 앞으로 나갔다 돌아오는 마찰이 크다)

## 이메일 중복 처리

`linkWithCredential` 이 `auth/email-already-in-use` (또는 `auth/credential-already-in-use`) 로 실패할 때:

```
현재 익명 계정에 데이터가 있나?  ← hasAnyData() (아래 정의)
  ├─ 없음 → signInWithEmailAndPassword 로 갈아탄다 (손실 0)
  └─ 있음 → 거부한다
            "이 이메일은 이미 다른 계정에 쓰이고 있습니다.
             이 기기의 기록 N건은 그 계정으로 넘어가지 않습니다."
            → [다른 이메일 쓰기]
            → [기록을 포기하고 그 계정으로 로그인]  (2단계 확인)
```

**데이터 병합 코드는 만들지 않는다.** 양쪽 `days`/`goals`/`presets` 를 읽어 합치는 작업은
같은 날짜 충돌 규칙까지 정해야 하고, 1인 개인 앱에서 발생 빈도가 극히 낮다.

## `public/db.js` 인증 API

기존 `signIn()`(무조건 익명 계정을 자동 생성)을 **제거한다** — 게이트를 무의미하게 만든다.

```js
observeAuth(cb)              // cb(null | { uid, isAnonymous, email, emailVerified })
startGuest()                 // signInAnonymously
signUp(email, password)      // 분기는 아래 참조
signInWithPassword(email, password)
signOutUser()
resendVerification()
sendReset(email)
hasAnyData()                 // 중복 충돌 판정용. 아래 정의
```

`observeAuth` 는 토큰 상태가 바뀔 때마다 호출된다 (로그인/로그아웃/링크 성공).
익명 uid에 자격을 연결하면 uid가 그대로라 `onAuthStateChanged`가 다시 불리지 않을 수 있으므로
`onIdTokenChanged`를 사용한다.
화면은 이 콜백 하나로 게이트↔캘린더를 전환한다.

### `signUp` 분기

| 진입 경로 | `auth.currentUser` | 동작 |
|---|---|---|
| 비회원 사용 중 → 설정에서 "회원 전환" | 익명 유저 | `linkWithCredential` — **uid 유지, 데이터 유지** |
| 게이트에서 바로 "회원가입" | `null` | `createUserWithEmailAndPassword` — 새 uid, 데이터 없음 |

`currentUser` 가 있는데 `isAnonymous === false` 인 경우(이미 회원)에는 `signUp` 을 부르지 않는다 —
그 상태에서는 설정 화면에 가입 폼 자체가 없다.

### `hasAnyData()` 판정 기준

읽기 2회로 끝낸다. 하나라도 참이면 "데이터 있음":

1. `users/{uid}` 문서가 존재하고 `profile`·`recentEntries` 중 하나라도 비어 있지 않다
2. `users/{uid}/days` 에 문서가 1건 이상 있다 (`limit(1)` 쿼리)

`goals`·`presets` 는 따로 세지 않는다 — 목표를 저장했으면 `profile` 이 반드시 있고,
프리셋을 만들었으면 항목을 추가한 것이라 `days` 나 `recentEntries` 가 이미 차 있다.
읽기 횟수를 늘릴 이유가 없다.

거부 문구에 표시하는 "기록 N건"은 **`days` 문서 개수**다 (`limit(1)` 이 아니라 실제 카운트가
필요하므로, 거부 분기에 진입한 뒤에만 한 번 더 센다 — 정상 경로에서는 세지 않는다).

## 키체인을 물리게 하는 마크업

iOS Safari 는 가입 시 **iCloud 키체인 저장을 제안**한다. 그러면 재설치 후에도 자동완성된다 —
실사용 복구율은 "비밀번호를 기억하느냐"가 아니라 **키체인이 잡아주느냐**로 결정된다.

```html
<input type="email"    autocomplete="username">
<input type="password" autocomplete="new-password">      <!-- 가입 -->
<input type="password" autocomplete="current-password">  <!-- 로그인 -->
```

**이 속성을 빼면 Safari 가 저장 제안을 하지 않는다.** 장식이 아니라 기능이다.

## 비밀번호 정책

- 최소 8자 (Firebase 기본은 6자 — 그보다 강하게 클라이언트에서 막는다)
- 공백만으로 이루어진 값 거부
- 가입 시 확인란 일치 검사
- 그 이상(대소문자·특수문자 강제)은 하지 않는다 — 마찰만 늘고, 키체인 생성 비밀번호가 이미 강하다

## 보안 규칙

**변경 없음.**

- `linkWithCredential` 이 uid 를 유지하므로 기존 uid 기반 규칙이 그대로 성립한다
- 미인증 상태에서도 사용을 허용하기로 했으므로 `request.auth.token.email_verified` 를 규칙에 넣지 않는다

## 분담

`../AGENTS.md` 「순서 — Codex를 먼저 돌린다」에 따라 순수 로직부터 발주한다.

| 대상 | 담당 | 근거 |
|---|---|---|
| `src/lib/authValidation.js`, `src/lib/authMessages.js` + 테스트 | **Codex** | 순수 함수, 입출력이 닫혀 있고, 테스트로 정답 판정 가능 |
| `public/db.js` 인증 함수 | Claude | Firebase 연동 (Codex 대상 아님) |
| 게이트 화면 · 설정 계정 섹션 마크업 | Claude | UI (Codex 대상 아님) |
| `public/app.js` 상태 전환 흐름 | Claude | UI |

### Codex 발주 범위

- `authValidation.js` — 이메일 형식 검증, 비밀번호 정책 검증(길이·공백·확인란 일치)
- `authMessages.js` — Firebase auth 에러 코드 → 한국어 메시지 매핑
  (`auth/email-already-in-use`, `auth/invalid-email`, `auth/weak-password`,
   `auth/wrong-password`, `auth/user-not-found`, `auth/too-many-requests`,
   `auth/network-request-failed`, 그 외 → 폴백)

## 검증

브라우저 실측으로 확인한다. "될 것이다"는 검증이 아니다.

1. 가입 → 로그아웃 → 재로그인 → **기록이 그대로인지** (uid 유지 확인)
2. 미인증 상태에서 경고가 상주하는지, 재발송 버튼이 동작하는지
3. 중복 이메일 거부 문구가 기록 건수를 실제 숫자로 표시하는지
4. **게이트가 기존 익명 세션을 건드리지 않는지** — 지금 쓰던 기록이 그대로 보여야 한다
5. 비회원 상태에 로그아웃 버튼이 없는지

## 확인 못 한 것

- 로그아웃 후 다른 계정으로 로그인했을 때 Firestore 오프라인 캐시(IndexedDB)에
  이전 uid 의 데이터가 남는지. 보안 규칙상 서버 읽기는 막히지만 **로컬 잔존 여부는 미검증**이다.
  1인 개인 기기라 위험은 낮다고 판단했지만, 사실로 쓰지 않는다
