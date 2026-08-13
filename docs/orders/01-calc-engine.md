# 발주 01 — 계산 엔진 (Codex)

담당: **Codex** · 상태: 발주 준비 완료 · 선행: 없음 (블로커와 무관, 지금 시작 가능)

공통 계약은 `../../AGENTS.md`. 여기 없는 규칙은 거기 따른다.
**여기 안 적힌 동작을 지어내지 않는다.** 빠진 게 있으면 채우지 말고 알린다.

## 만들 것

| 파일 | 내용 |
|---|---|
| `src/lib/metabolism.js` | BMR · TDEE · 목적별 매크로 배분 |
| `src/lib/units.js` | 영양성분 단위 환산 |
| `tests/metabolism.test.js` | 위 테스트 |
| `tests/units.test.js` | 위 테스트 |

- 순수 함수만. `import`는 `node:` 내장 모듈만 허용. DOM·네트워크·Firebase 금지
- ESM (`export function ...`). 빌드 스텝 없음
- 실행: `npm test`

---

# A. `src/lib/metabolism.js`

## A-1. `calcBMR({ sex, weightKg, heightCm, age })`

Mifflin-St Jeor:

```
male:   10*weightKg + 6.25*heightCm - 5*age + 5
female: 10*weightKg + 6.25*heightCm - 5*age - 161
```

- `sex`: `'male' | 'female'`
- 반환: `number` — **반올림하지 않는다.** 중간 계산이므로 정밀도를 유지한다
- 반올림은 최종 목표값에서 한 번만 한다 (A-3)

**입력 검증** — 아래 벗어나면 `RangeError`:

| 인자 | 허용 범위 |
|---|---|
| `weightKg` | 20 이상 300 이하 |
| `heightCm` | 100 이상 250 이하 |
| `age` | 10 이상 120 이하 |

`sex`가 두 값 중 하나가 아니면 `TypeError`.
숫자 인자가 `number`가 아니거나 `NaN`이면 `TypeError`.

> 범위를 두는 이유: 오타(체중 700kg)가 조용히 통과하면 목표 칼로리가 말이 안 되는 값이 되고,
> 그게 그대로 룰렛에 들어간다. **클램프하지 말고 던진다.**

## A-2. `calcTDEE(bmr, weeklyWorkouts)`

```
TDEE = bmr * 활동계수
```

| `weeklyWorkouts` | 계수 |
|---|---|
| 0 | 1.2 |
| 1, 2, 3 | 1.375 |
| 4, 5 | 1.55 |
| 6, 7 | 1.725 |

- `weeklyWorkouts`: 0~7 정수. 벗어나거나 정수가 아니면 `RangeError`
- 반환: `number` — 반올림 안 함

## A-3. `calcTargets({ tdee, weightKg, goal })`

`goal`: `'diet' | 'leanbulk' | 'bulk'`

| goal | 칼로리 | 단백질 | 지방 |
|---|---|---|---|
| `diet` | `tdee * 0.85` | `weightKg * 2.0` g | 총kcal의 25% |
| `leanbulk` | `tdee * 1.05` | `weightKg * 1.8` g | 총kcal의 25% |
| `bulk` | `tdee * 1.15` | `weightKg * 1.6` g | 총kcal의 25% |

**계산 순서 — 반드시 이 순서다:**

```
1. kcal      = tdee * 계수
2. proteinG  = weightKg * goal별 g/kg
3. fatG      = (kcal * 0.25) / 9
4. carbG     = (kcal - proteinG*4 - fatG*9) / 4      ← 잔여
```

1g당 열량: 탄수 4, 단백질 4, 지방 9.

> 순서를 바꾸면 단백질이 깎인다. 단백질·지방을 먼저 고정하고 탄수를 잔여로 둔다.

**반환 — 여기서만 반올림한다:**

```js
{
  kcal: <정수>,        // Math.round
  proteinG: <정수>,    // Math.round
  fatG: <정수>,        // Math.round
  carbG: <정수>,       // Math.round
  bmr: <정수>,         // Math.round — 표시용
  tdee: <정수>         // Math.round — 표시용
}
```

**반올림 규칙:** `Math.round` (0.5는 올림). 반올림은 **각 값을 독립적으로** 한다 —
반올림 후 `proteinG*4 + fatG*9 + carbG*4`가 `kcal`과 정확히 안 맞아도 된다. 맞추려고 보정하지 않는다.

**퇴화 케이스 — 이게 이 발주의 핵심이다:**

`carbG`가 **음수로 계산되면** 목표 설정이 모순이다 (단백질+지방만으로 칼로리 초과).
**0으로 클램프하지 않는다.** 다음 에러를 던진다:

```js
class ImpossibleTargetError extends Error {}
```

- `metabolism.js`에서 `export` 한다
- `message`에 계산된 음수 `carbG` 값과 `kcal`을 포함한다 (디버깅용)
- `carbG === 0`은 **정상이다.** 던지지 않는다. 음수일 때만 던진다

> 조용히 0으로 만들면 사용자는 "탄수 0g" 목표를 받고 그게 정상인 줄 안다.

---

# B. `src/lib/units.js`

## B-1. `scaleNutrients(per100g, amountG)`

100g 기준 영양성분을 실제 섭취량으로 환산.

```js
per100g = { kcal, carbG, proteinG, fatG }   // 각 number 또는 null
amountG = number
```

**반환:** 같은 형태. 각 값 `= value * amountG / 100`.

- **소수점 1자리로 반올림** (`Math.round(x*10)/10`). 칼로리도 동일
- **`null`은 `null`로 통과시킨다.** `0`으로 바꾸지 않는다
  → `null`(값 없음)과 `0`(진짜 0g)은 다르다. 섞으면 "지방 0g 음식"이 만들어진다
- `amountG`가 0이면 전부 0 (단, `null`은 `null` 유지)
- `amountG`가 음수거나 `NaN`이면 `RangeError`
- `per100g`에 4개 키 중 없는 게 있으면 `null`로 취급한다

## B-2. `kjToKcal(kj)`

```
kcal = kj / 4.184
```

- 소수점 1자리 반올림
- `null` → `null`
- 음수·`NaN` → `RangeError`

> Open Food Facts는 kJ로 준다. 환산 없이 kcal 자리에 넣으면 칼로리가 4배가 된다.

## B-3. `checkCalorieConsistency({ kcal, carbG, proteinG, fatG })`

표기 칼로리와 매크로 계산 칼로리가 어긋나는지 본다. 파싱 오류·원본 데이터 오류 탐지용.

```
계산kcal = carbG*4 + proteinG*4 + fatG*9
편차     = |계산kcal - kcal| / kcal
```

**반환:**

```js
{ ok: <boolean>, calculatedKcal: <소수1자리>, deviation: <소수3자리> }
```

- `ok`는 편차가 **0.20 이하**일 때 `true`
- 4개 중 **하나라도 `null`이면** 판정 불가 → `{ ok: null, calculatedKcal: null, deviation: null }`
- `kcal`이 0이면 나눗셈 불가 → 같은 판정 불가 형태를 반환한다. **던지지 않는다**

> 이 함수는 던지지 않는다. 판정 결과만 돌려준다 — 호출부가 경고를 띄울지 정한다.

---

# 테스트 요구사항

`tests/metabolism.test.js`, `tests/units.test.js`. `node:test` + `node:assert/strict`.

**반드시 포함:**

1. **정상 경로** — `goal` 3종 × `sex` 2종 × 활동계수 4구간을 덮는다
2. **경계값**
   - 각 범위의 **최소/최대 바로 안쪽과 바로 바깥쪽** (예: `weightKg` 20, 19.9, 300, 300.1)
   - `weeklyWorkouts` 계수 경계: 0/1, 3/4, 5/6, 7/8
   - `amountG = 0`
   - `carbG`가 정확히 0이 되는 입력 → **던지지 않음**을 확인
3. **`ImpossibleTargetError`** — 음수 `carbG`를 만드는 입력으로 실제로 던지는지
4. **`null` 전파** — `scaleNutrients`·`kjToKcal`에서 `null`이 `0`으로 안 바뀌는지
5. **`checkCalorieConsistency`가 던지지 않음** — `kcal: 0`, `null` 포함 입력에서
6. **계산 순서 검증** — 단백질이 목표대로 나오는지 (탄수 잔여 방식이 지켜졌는지)

**금지:**

- 실제 음식의 영양 수치를 테스트 픽스처에 쓰지 않는다 (`AGENTS.md` 절대규칙 2).
  숫자는 **이 문서의 공식으로 직접 계산한 값**이거나 임의의 합성값이어야 한다
- 구현을 보고 기대값을 베끼지 않는다. **이 문서의 공식에서 손으로 유도한다**
- 스냅샷 테스트 금지

## 완료 보고

`AGENTS.md`의 「완료 보고 형식」대로. `npm test` **실제 출력**을 붙인다.

## 판단이 필요하면

멈추고 묻는다. 특히:
- 이 문서에 기대 동작이 안 적힌 입력을 발견했을 때
- 공식이 서로 모순되어 보일 때

**빈칸을 채우지 않는다.** 비었으면 비었다고 알리는 게 맞는 행동이다.
