# 발주 03 — 계산 엔진 에러 처리 보강 (Codex)

담당: **Codex** · 대상: `src/lib/metabolism.js`, `src/lib/units.js` (기존 파일 수정) · 선행: 발주 01 (완료·리뷰됨)

공통 계약은 `../../AGENTS.md`. **여기 안 적힌 동작을 지어내지 않는다.** 빠진 게 있으면 채우지 말고 알린다.

## 문제 (발주 01 리뷰에서 발견, 5건)

1. 모든 `TypeError`/`RangeError`가 메시지 없이 던져진다 (`throw new TypeError()`). 원인을 못 읽는다.
2. `kjToKcal(undefined)` → 조용히 `NaN` 반환. `null`만 걸러지고 그 외 비정상 입력은 안 걸러진다.
3. `calcTDEE(undefined, 3)` → 조용히 `NaN` 반환. `bmr` 자체가 검증 안 된다.
4. `scaleNutrients({kcal: undefined, ...}, 100)` → 해당 키가 조용히 `NaN`으로 계산된다.
5. `calcTargets({tdee, weightKg, goal: 'invalid'})` → `GOALS[goal]`가 `undefined`라 구조분해가 실패,
   노출되는 메시지가 `Cannot destructure property 'calorieMultiplier' of 'undefined' as it is undefined.`
   — 내부 구현(객체 구조분해)이 그대로 노출된다.

**절대규칙 7** (퇴역 케이스를 조용히 뭉개지 않는다) 위반. `NaN` 반환은 에러 없이 잘못된 숫자가
룰렛 단계까지 흘러가는 것과 같다 — "조용히 뭉개기"의 다른 형태다.

## 에러 메시지 형식 (전 함수 공통)

```
"<functionName>: <field> <constraint>, got <value>"
```

- `<value>`는 템플릿 리터럴에 값을 그대로 넣는다 (`${value}` 또는 `${JSON.stringify(value)}` — 아래 각 항목에 명시)
- **주의**: `JSON.stringify(NaN)`은 문자열 `"null"`을 반환한다 (실제 `null`이 아니라 `null`이라는 4글자 문자열).
  `NaN` 값을 메시지에 넣을 때 `JSON.stringify`를 쓰면 `null`로 보여 오해를 준다.
  `NaN`이 확인된 자리는 `JSON.stringify` 대신 리터럴 문자열 `NaN`을 직접 쓴다 (아래 개별 항목에 명시)
- 여러 필드가 동시에 잘못됐으면 **먼저 걸리는 것 하나만** 던진다. 검증 순서는 각 절에 명시된 순서를 따른다

## A. `src/lib/metabolism.js`

### A-1. `calcBMR` — 메시지 추가 (검증 로직 자체는 안 바뀐다)

| 조건 | 에러 | 메시지 |
|---|---|---|
| `sex`가 `'male'`/`'female'` 아님 | `TypeError` | `` `calcBMR: sex must be "male" or "female", got ${JSON.stringify(sex)}` `` |
| `weightKg`가 `number` 아니거나 `NaN` | `TypeError` | `` `calcBMR: weightKg must be a number, got ${JSON.stringify(weightKg)}` `` (단, 값이 `NaN`이면 `got NaN`으로 — 위 주의사항 참조) |
| `weightKg`가 20~300 범위 밖 | `RangeError` | `` `calcBMR: weightKg must be between 20 and 300, got ${weightKg}` `` |
| `heightCm`가 `number` 아니거나 `NaN` | `TypeError` | `` `calcBMR: heightCm must be a number, got ${JSON.stringify(heightCm)}` `` (NaN 예외 동일) |
| `heightCm`가 100~250 범위 밖 | `RangeError` | `` `calcBMR: heightCm must be between 100 and 250, got ${heightCm}` `` |
| `age`가 `number` 아니거나 `NaN` | `TypeError` | `` `calcBMR: age must be a number, got ${JSON.stringify(age)}` `` (NaN 예외 동일) |
| `age`가 10~120 범위 밖 | `RangeError` | `` `calcBMR: age must be between 10 and 120, got ${age}` `` |

검증 순서: 기존 그대로 `sex → weightKg → heightCm → age`. 각 필드는 타입 체크 후 범위 체크.

`assertNumber`/`assertInRange` 헬퍼에 `funcName`·`label`(필드명) 인자를 추가해 메시지를 조립한다.
헬퍼 시그니처는 자유 — 조립된 메시지가 위 표와 정확히 일치하기만 하면 된다.

### A-2. `calcTDEE(bmr, weeklyWorkouts)` — `bmr` 검증 추가 (신규)

**지금 없는 검증.** 추가한다:

- `bmr`이 `number`가 아니거나 `NaN`이면 `TypeError`:
  `` `calcTDEE: bmr must be a number, got ${JSON.stringify(bmr)}` `` (`bmr`이 `NaN`이면 `got NaN`)
- `bmr`의 범위는 검증하지 않는다 — `calcBMR`을 거치지 않고 직접 호출될 수도 있어 타입만 본다
- 기존 `weeklyWorkouts` 검증에 메시지 추가:
  `` `calcTDEE: weeklyWorkouts must be an integer between 0 and 7, got ${JSON.stringify(weeklyWorkouts)}` ``

검증 순서: `bmr` 먼저, `weeklyWorkouts` 다음.

### A-3. `calcTargets({ tdee, weightKg, goal })` — `goal`/`tdee`/`weightKg` 검증 추가 (신규)

**지금 `GOALS[goal]`로 바로 구조분해한다 — 이걸 막는다.** 먼저 `goal` 유효성을 확인:

```js
if (!Object.hasOwn(GOALS, goal)) {
  throw new TypeError(`calcTargets: goal must be one of ${Object.keys(GOALS).join(', ')}, got ${JSON.stringify(goal)}`);
}
```

`tdee`·`weightKg`도 검증한다 (지금 전혀 안 됨 — 이것도 undefined→NaN 전파 경로):

| 조건 | 에러 | 메시지 |
|---|---|---|
| `tdee`가 `number` 아니거나 `NaN` | `TypeError` | `` `calcTargets: tdee must be a number, got ${JSON.stringify(tdee)}` `` (NaN이면 `got NaN`) |
| `weightKg`가 `number` 아니거나 `NaN` | `TypeError` | `` `calcTargets: weightKg must be a number, got ${JSON.stringify(weightKg)}` `` (NaN이면 `got NaN`) |

검증 순서: `tdee` → `weightKg` → `goal`.

`ImpossibleTargetError` 메시지는 기존 그대로 유지한다 (이미 값을 포함하고 있다 — 이 발주 대상 아님).

### A-4. `buildGoalProfile` — 변경 없음

하위 함수 에러를 그대로 올리는 기존 동작 유지. 메시지는 하위에서 채워지므로 자동으로 좋아진다.

## B. `src/lib/units.js`

### B-1. `scaleNutrients(per100g, amountG)`

**`amountG` 검증 보강** (지금은 `undefined`가 두 체크를 다 통과해 `NaN`이 조용히 나온다):

| 조건 | 에러 | 메시지 |
|---|---|---|
| `amountG`가 `number` 아님 (`undefined` 포함) | `RangeError` | `` `scaleNutrients: amountG must be a number, got ${JSON.stringify(amountG)}` `` |
| `amountG`가 `NaN` | `RangeError` | `` `scaleNutrients: amountG must be a number, got NaN` `` (리터럴, `JSON.stringify` 쓰지 않음) |
| `amountG`가 음수 | `RangeError` | `` `scaleNutrients: amountG must not be negative, got ${amountG}` `` |

**영양소 키별 값 검증 보강:**

키가 있고 값이 `null`이 아닌데 `number`도 아니거나(`undefined`, 문자열 등) `NaN`이면:

```js
throw new TypeError(`scaleNutrients: per100g.${key} must be a number or null, got ${JSON.stringify(per100g[key])}`);
```

(값이 `NaN`인 경우는 `got NaN` 리터럴)

- 키가 아예 없는 경우(`!Object.hasOwn`)는 지금처럼 `null`로 취급 — **기존 동작 유지, 바꾸지 않는다**
- 검증 순서: `amountG` 먼저(타입 → NaN → 범위), 그 다음 `NUTRIENT_KEYS` 순서(`kcal, carbG, proteinG, fatG`)대로 첫 번째로 걸리는 키에서 던진다

### B-2. `kjToKcal(kj)`

- `kj === null` → `null` 반환 (기존 유지)
- `kj`가 `number`가 아니면(`undefined` 포함, `NaN`은 **제외** — 아래 참조) → `TypeError`:
  `` `kjToKcal: kj must be a number or null, got ${JSON.stringify(kj)}` ``
- `kj`가 `NaN`이면 → `RangeError`: `` `kjToKcal: kj must be a number, got NaN` `` (리터럴)
- `kj`가 음수면 → `RangeError`: `` `kjToKcal: kj must not be negative, got ${kj}` ``
- 검증 순서: 타입 체크(`TypeError`, `null`/`undefined`/`number` 아닌 값) 먼저, 그다음 `NaN`(`RangeError`), 그다음 음수(`RangeError`)

> **정정 (2026-08-13, 1차 실행 리뷰에서 발견):** 초안은 `NaN`을 `TypeError`로 분류했는데,
> 이 발주가 건드리기 전인 발주01 원본 명세(`orders/01-calc-engine.md` B-2)가 이미
> `kjToKcal`·`scaleNutrients` 둘 다 "`NaN` → `RangeError`"로 정해놨고 기존 테스트가 그걸 잠그고 있다.
> `scaleNutrients`의 `amountG`는 초안에서도 `RangeError`로 맞게 썼는데 `kjToKcal`만 어긋났다 —
> 같은 파일 안에서 "숫자가 아님"의 의미가 함수마다 달라지면 안 되므로 **기존 관례(`RangeError`)를 따른다.**

### B-3. `checkCalorieConsistency` — 변경 없음

이 함수는 원래도 안 던진다 (판정 불가를 반환하는 설계). 이번 발주 대상 아님.

## 테스트 추가 (기존 테스트 파일에 추가, 새 파일 만들지 않는다)

`tests/metabolism.test.js`, `tests/units.test.js`에 추가한다.

**필수 케이스:**

1. 위 표의 **에러 메시지가 정확히 일치**하는지 (`assert.throws(fn, { message: '...' })` 또는 동등한 방식으로) —
   최소한 각 함수당 대표 케이스 1개 이상, `calcBMR`은 4개 필드 전부
2. **회귀 테스트 (이 발주의 핵심)** — 아래가 `NaN`을 반환하지 않고 **던지는지** 직접 확인:
   - `kjToKcal(undefined)`
   - `calcTDEE(undefined, 3)`
   - `scaleNutrients({ kcal: undefined, carbG: null, proteinG: 10, fatG: 5 }, 100)`
3. `calcTargets({ tdee: 2000, weightKg: 70, goal: 'invalid' })` — 메시지에 `Cannot destructure`가
   **포함되지 않는지** 확인 (내부 구현 비노출 확인)
4. 기존 22개 테스트가 **여전히 통과**해야 한다. 타입만 확인하던 기존 `assert.throws(fn, TypeError)` 형태는
   그대로 두고, 메시지 확인은 **새 테스트로 추가**한다 (기존 assertion을 메시지 체크로 바꾸지 않는다)

## 완료 조건

- `npm test` 전체 통과 (기존 22개 + 신규)
- 기존 함수 시그니처·반환 형태·계산 로직 **변경 없음** — 이번 발주는 에러 처리만 보강한다

## 완료 보고

`../../AGENTS.md`의 「완료 보고 형식」대로. `npm test` **실제 출력**을 붙인다.

## 판단이 필요하면

멈추고 묻는다. 특히:
- 메시지 형식이 이 문서와 충돌하는 입력을 발견했을 때
- 위 표에 없는 필드·함수에서 같은 문제(무메시지·NaN전파)를 발견했을 때 — **알아서 고치지 말고 보고**
