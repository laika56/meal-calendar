export function isSafeExternalUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Render one response-provided search result without interpolating food data as HTML. */
export function createSearchResult(document, food, { servingLabel = '', onSelect } = {}) {
  const result = document.createElement('div');
  result.className = 'search-result';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'search-result-main';
  const name = document.createElement('span');
  name.className = 'r-name';
  name.textContent = food.name;
  const meta = document.createElement('span');
  meta.className = 'r-meta';

  const kcalText = Number.isFinite(food.per100g?.kcal) ? Math.round(food.per100g.kcal) : '?';
  const officialServing = food.serving?.source === 'official-serving'
    && Number.isFinite(food.servingNutrients?.kcal);
  const nutritionLabel = officialServing
    ? `1인분 ${food.serving.amount}${food.serving.unit} · ${Math.round(food.servingNutrients.kcal)}kcal`
    : `100g당 ${kcalText}kcal`;
  const sourceDetails = [food.maker, food.source?.label].filter(Boolean);
  meta.textContent = sourceDetails.length > 0
    ? [...sourceDetails, nutritionLabel, ...(officialServing || !servingLabel ? [] : [servingLabel])].join(' · ')
    : [food.category, nutritionLabel, servingLabel].filter(Boolean).join(' · ');

  button.append(name, meta);
  if (onSelect) button.addEventListener('click', onSelect);
  result.appendChild(button);

  if (isSafeExternalUrl(food.source?.url)) {
    const sourceLink = document.createElement('a');
    sourceLink.className = 'r-source-link';
    sourceLink.href = food.source.url;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = '출처 보기';
    result.appendChild(sourceLink);
  }
  return result;
}
