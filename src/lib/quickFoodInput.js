const KOREAN_AMOUNTS = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  반: 0.5,
};

// 영양값은 여기 두지 않는다. 아래 숫자는 자연어 단위를 g으로 바꾸기 위한 대표 중량뿐이다.
// - 달걀 50g: 식약처 「외식 메뉴의 영양성분 함량 산출 가이드」 예시
// - 밥 1공기 200g: 질병관리청 국가건강정보포털 탄수화물 안내
const SERVING_RULES = [
  {
    unit: '개',
    aliases: ['반숙란', '반숙계란', '삶은계란', '삶은달걀', '계란', '달걀'],
    grams: 50,
    source: 'mfds-egg-50g',
  },
  {
    unit: '공기',
    aliases: ['밥', '쌀밥', '흰쌀밥', '잡곡밥', '현미밥'],
    grams: 200,
    source: 'kdca-rice-bowl-200g',
  },
];

export const SERVING_SOURCE_LABELS = {
  'mfds-egg-50g': '식약처 달걀 1개 50g 기준',
  'kdca-rice-bowl-200g': '질병관리청 밥 1공기 200g 기준',
};

function formatValue(value) {
  if (Number.isNaN(value)) return 'NaN'; // JSON.stringify(NaN) 은 'null' 을 돌려준다 — 그대로 쓰면 오진단을 부른다
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function compact(value) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

function parseAmount(token) {
  return Object.hasOwn(KOREAN_AMOUNTS, token) ? KOREAN_AMOUNTS[token] : Number(token);
}

function invalidAmount(query) {
  return { ok: false, reason: 'invalid-amount', query };
}

export function parseQuickFoodInput(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`parseQuickFoodInput: input must be a string, got ${formatValue(input)}`);
  }

  const normalized = input.trim().replace(/\s+/g, ' ');
  if (!normalized) return { ok: false, reason: 'empty', query: '' };

  const gramMatch = normalized.match(/^(.*?)(\d+(?:\.\d+)?)\s*(?:g|그램)$/i);
  if (gramMatch) {
    const query = gramMatch[1].trim();
    const amountG = Number(gramMatch[2]);
    if (!query) return { ok: false, reason: 'food-required', query: '' };
    if (!Number.isFinite(amountG) || amountG <= 0) return invalidAmount(query);
    return {
      ok: true,
      query,
      amountG,
      displayAmount: `${gramMatch[2]}g`,
      estimated: false,
      servingSource: null,
    };
  }

  const servingMatch = normalized.match(
    /^(.*?)(\d+(?:\.\d+)?|한|두|세|네|반)\s*(개|공기|팩|봉|봉지)$/,
  );
  if (!servingMatch) {
    return { ok: false, reason: 'quantity-required', query: normalized };
  }

  const query = servingMatch[1].trim();
  const amount = parseAmount(servingMatch[2]);
  const unit = servingMatch[3];
  if (!query) return { ok: false, reason: 'food-required', query: '' };
  if (!Number.isFinite(amount) || amount <= 0) return invalidAmount(query);

  const compactQuery = compact(query);
  const rule = SERVING_RULES.find((candidate) => (
    candidate.unit === unit
    && candidate.aliases.some((alias) => compactQuery.includes(compact(alias)))
  ));
  if (!rule) return { ok: false, reason: 'unsupported-serving', query };

  return {
    ok: true,
    query,
    amountG: amount * rule.grams,
    displayAmount: unit === '공기' ? `${servingMatch[2]} 공기` : `${servingMatch[2]}${unit}`,
    estimated: true,
    servingSource: rule.source,
  };
}

export function splitQuickFoodInput(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`splitQuickFoodInput: input must be a string, got ${formatValue(input)}`);
  }

  return input
    .split(/[,\n]/)
    .map((fragment) => fragment.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, 10)
    .map((text) => ({ text, parsed: parseQuickFoodInput(text) }));
}

function validateMatchArgs(fnName, query, foods) {
  if (typeof query !== 'string') {
    throw new TypeError(`${fnName}: query must be a string, got ${formatValue(query)}`);
  }
  if (!Array.isArray(foods)) {
    throw new TypeError(`${fnName}: foods must be an array, got ${formatValue(foods)}`);
  }
  foods.forEach((food, index) => {
    if (!food || typeof food.name !== 'string') {
      throw new TypeError(`${fnName}: foods[${index}].name must be a string`);
    }
  });
}

// 이름 매칭 3단계(정확 일치 → 접두 → 부분문자열) 중 하나라도 걸리면 그 식품을 돌려준다.
// 전부 실패하면 undefined다 — 호출부가 foods[0] 폴백을 쓸지, 확인을 요구할지 정한다.
function findByName(query, foods) {
  const wanted = compact(query);
  return foods.find((food) => compact(food.name) === wanted)
    ?? foods.find((food) => compact(food.name).startsWith(wanted))
    ?? foods.find((food) => compact(food.name).includes(wanted));
}

export function selectBestFood(query, foods) {
  validateMatchArgs('selectBestFood', query, foods);
  if (foods.length === 0) return null;
  return findByName(query, foods) ?? foods[0];
}

/**
 * 이름이 정말로 맞아떨어지는 후보가 있는지 (정확·접두·부분문자열 중 하나).
 * false 면 selectBestFood 의 결과는 foods[0] 폴백이라는 뜻이다 — 이름이 전혀 안 맞는데
 * 그냥 첫 검색 결과를 고른 것이므로, 호출부는 그 값을 확인 없이 바로 기록하면 안 된다.
 */
export function hasNameMatch(query, foods) {
  validateMatchArgs('hasNameMatch', query, foods);
  if (foods.length === 0) return false;
  return findByName(query, foods) !== undefined;
}
