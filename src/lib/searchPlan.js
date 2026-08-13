function planKey(entry) {
  return JSON.stringify(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildSearchPlan(query) {
  if (typeof query !== 'string') {
    throw new TypeError(
      `buildSearchPlan: query must be a string, got ${JSON.stringify(query)}`,
    );
  }

  const normalized = query.trim().replace(/\s+/g, ' ');
  if (normalized === '') return [];

  const tokens = normalized.split(' ');
  const candidates = tokens.length === 1
    ? [
      { FOOD_NM_KR: normalized },
      { MAKER_NM: normalized },
    ]
    : [
      { FOOD_NM_KR: normalized },
      { MAKER_NM: tokens[0], FOOD_NM_KR: tokens.slice(1).join(' ') },
      { MAKER_NM: tokens[0] },
      { FOOD_NM_KR: tokens.slice(1).join(' ') },
    ];

  const seen = new Set();
  return candidates.filter((entry) => {
    const key = planKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}
