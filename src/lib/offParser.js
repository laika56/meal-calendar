const NUTRIENT_FIELDS = [
  ['kcal', 'energy-kcal'],
  ['proteinG', 'proteins'],
  ['fatG', 'fat'],
  ['carbG', 'carbohydrates'],
];

function parseNutrient(nutriments, label, field, code) {
  if (!Object.hasOwn(nutriments, field)) return null;

  const value = nutriments[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `parseOffProduct: ${label} is not a valid number, got ${JSON.stringify(value)} for ${code}`,
    );
  }
  if (value < 0) {
    throw new Error(
      `parseOffProduct: ${label} is not a valid number, got ${JSON.stringify(value)} for ${code}, must not be negative`,
    );
  }

  return value;
}

/**
 * OFF 의 1회 제공량. **포장 제품은 1회분이 포장에 찍혀 있다** — 그걸 무시하고
 * 사용자에게 그램을 물으면 스캔의 의미가 없다(2026-08-19 사용자 지적).
 *
 * **표본이 좁다 — N=8 이다.** `tests/fixtures/off-sample.json` 7건 + 사용자가 실제로
 * 찍은 제품 1건. OFF 검색 API 가 503이라 `AGENTS.md` 가 요구하는 N≥300 분포를 못 떴다.
 * **이 밖의 형태는 미검증이다.**
 *
 * 그 8건에서 실측한 것:
 *
 * | 형태 | 건수 |
 * |---|---|
 * | `serving_quantity` 있고 `serving_quantity_unit` **도** 있음 | 1 (사용자 제품, `80`+`g`) |
 * | `serving_quantity` 는 있는데 **단위 필드가 없음** | 4 (`140`, `230`, `250`, `120`) |
 * | 둘 다 없음 / `null` | 3 |
 *
 * **단위를 기준(`nutrition_data_per`)에서 추측하지 않는 이유가 이 표본에 있다:**
 * `per_100g_liquid_product` 는 영양 기준이 `100g` 인데 `serving_size` 표기는 `1 pouch
 * (230 ml)` 다. 기준에서 단위를 빌려왔으면 230 g 으로 잡아 틀린 숫자를 만든다.
 * 그래서 **단위가 명시된 경우만** 받는다. 나머지는 지금까지와 똑같이 「1인분 모름」으로
 * 떨어질 뿐이라 나빠지지 않는다. 틀린 1회분은 5배 오류를 만든다(발주16).
 *
 * 자유 텍스트 `serving_size`(`'1 portion (120 g)'`)는 **파싱하지 않는다** — 발주28 의
 * 결정이고 그대로 유지한다. 여기서 쓰는 건 구조화된 숫자 필드다.
 *
 * @param basisUnit `nutrition_data_per` 에서 유도한 'g' | 'ml'
 */
function parseServing(product, basisUnit) {
  const raw = product.serving_quantity;
  // 문자열로 오는 경우가 있다. 빈 문자열은 Number('')===0 이라 따로 걸러야 한다.
  const amount = typeof raw === 'number'
    ? raw
    : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const rawUnit = product.serving_quantity_unit;
  if (typeof rawUnit !== 'string') return null;
  const unit = rawUnit.trim().toLowerCase();
  if (unit !== 'g' && unit !== 'ml') return null;

  // 단위가 기준과 다르면 버린다. per100 이 100g 기준인데 1회분이 mL 이면 환산이
  // 성립하지 않는다 — 발주16 에서 같은 함정으로 5배 오류가 났었다.
  if (unit !== basisUnit) return null;

  return { amount, unit, source: 'off-serving' };
}

export function parseOffProduct(response) {
  if (response.status !== 1 || !response.product) return null;

  const { product } = response;
  const identity = {
    code: response.code,
    name: product.product_name ?? null,
    brand: product.brands ?? null,
  };

  if (product.nutrition_data_per == null) {
    // 기준 단위를 모르면 1회분의 단위도 대조할 수 없다 — 그대로 모른다고 둔다.
    return {
      ...identity,
      unit: null,
      per100: null,
      serving: null,
    };
  }

  let unit;
  if (product.nutrition_data_per === '100g') {
    unit = 'g';
  } else if (product.nutrition_data_per === '100ml') {
    unit = 'ml';
  } else {
    throw new Error(
      `parseOffProduct: unexpected nutrition_data_per ${JSON.stringify(product.nutrition_data_per)} for ${response.code}`,
    );
  }

  return {
    ...identity,
    unit,
    serving: parseServing(product, unit),
    per100: Object.fromEntries(
      NUTRIENT_FIELDS.map(([label, field]) => [
        label,
        parseNutrient(product.nutriments ?? {}, label, field, response.code),
      ]),
    ),
  };
}
