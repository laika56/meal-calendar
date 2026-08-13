function validateFoodCode(item) {
  if (
    typeof item !== 'object'
    || item === null
    || typeof item.foodCode !== 'string'
    || item.foodCode === ''
  ) {
    throw new TypeError('mergeSearchResults: every item must have a non-empty string foodCode');
  }
}

export function mergeSearchResults(batches) {
  if (!Array.isArray(batches)) {
    throw new TypeError('mergeSearchResults: batches must be an array');
  }

  const merged = [];
  const seen = new Set();

  for (const batch of batches) {
    if (!Array.isArray(batch)) {
      throw new TypeError('mergeSearchResults: every batch must be an array');
    }

    for (const item of batch) {
      validateFoodCode(item);
      if (seen.has(item.foodCode)) continue;

      seen.add(item.foodCode);
      merged.push(item);
    }
  }

  return merged;
}

function normalizeText(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function relevanceScore(item, normalizedQuery, tokens) {
  const normalizedName = normalizeText(item.name);
  const normalizedMaker = typeof item.maker === 'string' ? normalizeText(item.maker) : '';
  let score = 0;

  if (normalizedName === normalizedQuery) score += 100;
  if (normalizedName.startsWith(normalizedQuery)) score += 50;
  if (normalizedName.includes(normalizedQuery)) score += 25;

  for (const token of tokens) {
    if (normalizedName.includes(token)) score += 10;
    if (normalizedMaker.includes(token)) score += 15;
  }

  if (item.foodGroup === 'dish') score += 20;
  if (item.foodGroup === 'ingredient') score -= 20;

  return score;
}

export function rankSearchResults(items, query) {
  if (!Array.isArray(items)) {
    throw new TypeError('rankSearchResults: items must be an array');
  }
  if (typeof query !== 'string') {
    throw new TypeError('rankSearchResults: query must be a string');
  }

  const normalizedQuery = normalizeText(query);
  if (normalizedQuery === '') return [...items];

  const tokens = normalizedQuery.split(' ');
  const ranked = items.map((item, index) => {
    if (typeof item !== 'object' || item === null || typeof item.name !== 'string') {
      throw new TypeError('rankSearchResults: every item must have a string name');
    }

    return {
      item,
      index,
      score: relevanceScore(item, normalizedQuery, tokens),
    };
  });

  // 점수가 같으면 입력 인덱스로 비교해 API가 준 원래 순서를 고정한다.
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.map(({ item }) => item);
}
