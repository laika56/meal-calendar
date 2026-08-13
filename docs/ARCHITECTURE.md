# 구조

## 전체 그림

```
iOS Safari (홈 화면 PWA)
  │
  ├─ Firestore SDK ──────────────► Firestore   (내 데이터. 보안 규칙으로 격리)
  │                                   ▲
  │                                   │ 캐시 쓰기
  └─ fetch /api/* ──► Cloud Functions ┘
                        │
                        ├─► 식약처 통합식품영양성분   (키 필요)
                        ├─► Open Food Facts          (키 불필요)
                        └─► Anthropic API            (키 필요, 선택)
```

**키를 아는 곳은 Cloud Functions 뿐이다.** 프론트는 `/api/*`만 안다.

## 왜 프록시가 필수인가

PWA는 정적 파일이다. 프론트에 넣은 키는 DevTools·소스보기·네트워크 탭에 전부 보인다.
난독화는 방어가 아니다. **프록시가 유일한 방법이다.**

Firebase Web SDK 설정값(`apiKey`, `projectId` 등)은 예외 — 이건 비밀이 아니라 공개 식별자다.
대신 그 경우 **Firestore 보안 규칙이 유일한 방어선**이 된다. 규칙 없이 배포하면 남이 내 데이터를 읽는다.

## 데이터 모델 (Firestore)

```
users/{uid}
  profile          { heightCm, birthYear, sex, activityLevel, updatedAt }
  dislikes         [ foodKey ]            기피 식품. 룰렛이 제외한다

users/{uid}/goals/{effectiveFrom}        YYYY-MM-DD. 목표는 바뀌므로 이력으로 쌓는다
  { mode, kcal, carbG, proteinG, fatG, bmr, tdee, note }

users/{uid}/days/{YYYY-MM-DD}            ← 로컬(Asia/Seoul) 날짜. UTC 금지
  weightKg
  slots {
    breakfast: [ entry ], lunch: [ entry ], dinner: [ entry ], snack: [ entry ]
  }
  totals           { kcal, carbG, proteinG, fatG }   읽기 최적화용 비정규화
  rouletteSeed     재현 가능한 룰렛을 위한 시드

users/{uid}/presets/{presetId}           1-Click 고정 식품
  { label, entry }

foods/{source}_{code}                    공용 캐시. 외부 API 쿼터 절약
  { source, code, name, per100g:{...}, servingG, fetchedAt }
```

### entry 형태

```js
{
  foodKey:  "mfds_D000123",   // {source}_{code}. 수동 입력은 "manual_<uuid>"
  name:     "닭가슴살 구이",
  amountG:  150,
  kcal, carbG, proteinG, fatG,  // amountG 기준으로 이미 환산된 값
  addedBy:  "manual" | "barcode" | "preset" | "roulette",
  at:       serverTimestamp
}
```

**환산값을 저장한다.** per100g만 저장하고 매번 계산하면, 나중에 DB가 수치를 고쳤을 때
과거 기록이 소급해서 바뀐다. 먹은 날의 기록은 그날 값으로 고정되어야 한다.

### 왜 `totals`를 중복 저장하나

캘린더는 한 화면에 30~31일을 그린다. 날마다 slots를 다 읽어 합치면 읽기 횟수가 30배가 된다.
`totals`만 읽도록 쿼리를 구성한다. **쓰기 시점에 갱신하며, 갱신 누락이 곧 버그다** — 테스트로 잠근다.

## 보안 규칙 (배포 전 필수)

```
match /users/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
match /foods/{doc} {
  allow read: if request.auth != null;
  allow write: if false;          // Cloud Functions(Admin SDK)만 쓴다
}
```

익명 인증을 쓰되 **계정 복구 경로를 만든다** — 익명 uid는 앱 삭제 시 사라진다.
나중에 이메일 링크로 승격(`linkWithCredential`)할 수 있게 설계해 둔다.

## Cloud Functions 엔드포인트

| 경로 | 하는 일 |
|---|---|
| `GET /api/foods/search?q=` | 식약처 검색 → 정규화 → `foods/` 캐시에 upsert |
| `GET /api/foods/barcode/:code` | Open Food Facts 조회 → 정규화 → 캐시 |
| `POST /api/roulette/explain` | (선택) solver 결과에 설명 문구. **숫자를 만들지 않는다** |

전부 인증 필요. 익명 uid라도 토큰 검증은 한다 — 안 하면 남이 내 쿼터를 태운다.

## 오프라인

- Firestore 오프라인 퍼시스턴스 활성화
- 서비스워커는 **앱 셸만** 캐싱한다. 영양 데이터는 Firestore가 알아서 한다
- 실패한 쓰기를 조용히 삼키지 않는다. UI에 "저장 대기 중" 상태를 노출한다

## iOS PWA 제약 (설계 시 전제)

- HTTPS 필수 — PWA 설치와 `getUserMedia`(카메라) 둘 다
- `BarcodeDetector` 없음 → `zxing-wasm`. 근거는 `DECISIONS.md`
- standalone 모드에서 카메라 권한이 매번 초기화될 수 있다 — 실기기 확인 항목
- safe-area inset 처리 필요 (노치·홈 인디케이터)
- 홈 화면 아이콘은 `apple-touch-icon` + manifest 둘 다 넣는다

**이 목록은 문서가 아니라 실기기에서 확인해야 확정된다.** 확인 전엔 전부 가설이다.
