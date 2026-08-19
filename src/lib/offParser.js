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
 * **실측 분포 (2026-08-19, 한국 제품 N=100).** OFF v2 검색으로 `countries_tags=south-korea`
 * 를 떠서 이 파서에 그대로 통과시킨 결과다. (2페이지부터 503이라 100건에서 멈췄다 —
 * `AGENTS.md` 가 요구하는 N≥300 에는 못 미친다.)
 *
 * | 결과 | 건수 |
 * |---|---|
 * | **1회분이 나온다** | **45** |
 * | 1회분 없음 — OFF 에 `serving_quantity` 자체가 없음 | 53 |
 * | 1회분 없음 — 단위가 영양 기준과 불일치해서 거부 | 2 |
 *
 * `serving_quantity_unit` 값 분포: `undefined` 53 · `'g'` 36 · `'ml'` 11.
 * **이상한 단위는 0건이다.** 그리고 `undefined` 53건은 「수량 자체가 없음」 53건과
 * 정확히 겹친다 — 즉 **수량이 있으면 단위도 항상 같이 온다.** 단위를 요구해서 잃는
 * 건수는 0이고, 거부한 2건은 실제로 틀렸을 값이다.
 *
 * **단위를 기준(`nutrition_data_per`)에서 추측하면 안 되는 이유**는 픽스처
 * `per_100g_liquid_product` 가 보여준다: 영양 기준이 `100g` 인데 `serving_size` 표기는
 * `1 pouch (230 ml)` 다. 기준에서 빌려왔으면 230 g 으로 잡아 틀린 숫자를 만든다.
 * 틀린 1회분은 5배 오류를 만든다(발주16).
 *
 * 참고: 같은 100건 중 **영양 4종이 완비돼 실제로 추가 가능한 것은 57건**이다.
 * 나머지는 1회분 이전에 영양값이 없어서 못 넣는다. 그리고 이 표본은 **OFF 에 이미
 * 있는 제품만** 센 것이라, 국내 제품이 OFF 에 얼마나 등재돼 있는지는 별개 문제다.
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
