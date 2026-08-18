# 발주 30 — 스캔 결과에 체크디지트 검증 배선

## 왜

발주29 가 `src/lib/barcode.js` 를 만들었지만 **아직 아무 데서도 안 쓴다.**
이 발주는 그걸 `src/lib/barcodeProduct.js` 의 스캔 경로에 붙인다.

지금 `normalizeRetailBarcode` 는 ZXing 결과 중 소매 형식인 첫 번째를 그대로
돌려준다. 체크디지트를 안 보므로 **오독한 숫자가 그대로 조회로 나간다.**
그리고 UPC-A 를 EAN-13 으로 정규화하지 않아 **있는 제품도 못 찾는다.**

## 건드릴 파일

| 파일 | 무엇 |
|---|---|
| `src/lib/barcodeProduct.js` | `normalizeRetailBarcode` 수정 |
| `tests/barcodeProduct.test.js` | 기존 파일에 케이스 추가 (없으면 신규) |

**`src/lib/barcode.js` 는 고치지 마라.** 리뷰 끝난 파일이다. import 해서 쓰기만 한다.
`public/` 아래는 건드리지 않는다.

## 명세

### `normalizeRetailBarcode(results)` — 동작을 바꾼다

시그니처는 그대로다. 입력은 ZXing 결과 배열 `[{ format, text }, …]`.

**새 동작 — 배열을 앞에서부터 훑으면서 첫 번째로 「쓸 수 있는」 값을 돌려준다:**

1. `format` 이 `EAN13` / `EAN8` / `UPCA` / `UPCE` 가 아니면 건너뛴다 (기존과 같음)
2. `text` 가 문자열이 아니면 건너뛴다 (기존과 같음)
3. `text.trim()` 이 비면 건너뛴다 (기존과 같음)
4. **`format` 이 `UPCE` 면 `upcEToUpcA` 로 확장한다. `null` 이면 건너뛴다** ← 신규
5. **`toEan13` 을 통과시킨다. `null` 이면 건너뛴다** ← 신규
6. 통과한 EAN-13 문자열을 돌려준다

하나도 못 찾으면 기존과 같이 `null`.

> **중요 — 「건너뛴다」이지 「멈춘다」가 아니다.** 스캐너는 한 프레임에서 결과를
> 여러 개 내놓는다. 앞의 것이 오독이어도 뒤에 멀쩡한 게 있을 수 있다.
> 하나 실패했다고 배열 전체를 포기하면 **되는 스캔이 조용히 안 되는 것처럼 보인다.**

**반환값이 항상 EAN-13(13자리)이 된다는 게 이 발주의 핵심이다.** 지금은 스캔된
원문이 그대로 나왔다.

### 예시

```js
// UPC-A 를 EAN-13 으로 정규화한다
normalizeRetailBarcode([{ format: 'UPCA', text: '036000291452' }])
// → '0036000291452'

// EAN-13 은 그대로
normalizeRetailBarcode([{ format: 'EAN13', text: '9780143007234' }])
// → '9780143007234'

// 체크디지트가 깨진 건 건너뛰고 뒤의 멀쩡한 걸 쓴다
normalizeRetailBarcode([
  { format: 'EAN13', text: '9780143007235' },   // 체크 틀림 → 건너뜀
  { format: 'EAN13', text: '9780143007234' },
])
// → '9780143007234'

// EAN-8 은 EAN-13 으로 확장 불가라 건너뛴다
normalizeRetailBarcode([{ format: 'EAN8', text: '96385074' }])
// → null

// UPC-E 는 확장한 뒤 정규화한다
normalizeRetailBarcode([{ format: 'UPCE', text: '04252614' }])
// → '0042100005264'   (UPC-A '042100005264' → 앞에 0)

// 형식이 소매가 아니면 건너뛴다
normalizeRetailBarcode([{ format: 'QR_CODE', text: '9780143007234' }])
// → null

// 공백은 잘라내고 판정한다
normalizeRetailBarcode([{ format: 'EAN13', text: '  9780143007234  ' }])
// → '9780143007234'

normalizeRetailBarcode([]) // → null
```

**`results` 가 배열이 아니면 기존처럼 `TypeError` 를 던진다.** 이건 바꾸지 마라.

### 검증된 픽스처

발주29 에서 계산해 확인한 값이다. 그대로 써라.

| 종류 | 입력 | 기대 |
|---|---|---|
| EAN-13 정상 | `9780143007234` | 그대로 |
| UPC-A 정상 | `036000291452` | `0036000291452` |
| EAN-8 정상 | `96385074` | `null` (확장 불가) |
| UPC-E 정상 | `04252614` | `0042100005264` |
| UPC-E 깨짐 | `01278906` | `null` |
| 체크 깨짐 | `9780143007235` | `null` |

## 테스트 요구사항

`tests/barcodeProduct.test.js`. **명세에서 유도해라.**

- [ ] 위 예시 블록의 **모든 케이스**
- [ ] 픽스처 표 전 행
- [ ] **건너뛰기 동작** — 깨진 것 뒤에 멀쩡한 게 있으면 그걸 쓴다. 순서를 바꾼
      케이스도 넣어라(멀쩡한 게 먼저 / 나중)
- [ ] 소매 형식이 아닌 항목이 섞여 있어도 뒤의 소매 항목을 찾는다
- [ ] `results` 가 배열이 아니면 `TypeError`
- [ ] `null`·`undefined` 원소가 배열에 섞여 있어도 던지지 않고 건너뛴다
- [ ] **기존 `barcodeProduct.js` 테스트가 그대로 통과하는지** — `buildOpenFoodFactsUrl`
      과 `toBarcodeFood` 는 이번에 안 바뀐다

## 수용 기준

```bash
npm test
```

전부 통과. 다른 세션이 편집 중인 파일 때문에 무관한 테스트가 실패하면 그건 네
책임이 아니다 — 있는 그대로 보고해라.

## 하지 말 것

- `src/lib/barcode.js` 수정
- `public/` 아래 수정
- 의존성 추가
- 커밋
