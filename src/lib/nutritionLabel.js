const EMPTY_RESULT = Object.freeze({
  amount: null, amountUnit: null, kcal: null,
  carbG: null, proteinG: null, fatG: null,
});

function oneMatch(text, pattern, map) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return null;
  return map(matches[0]);
}

function oneLineValue(text, labels, unit, { unitOptional = false } = {}) {
  const linePattern = new RegExp(`(?:${labels})\\s*[:：]?\\s*([^\\r\\n]*)`, 'giu');
  const lines = [...text.matchAll(linePattern)];
  if (lines.length !== 1) return null;
  const values = [...lines[0][1].matchAll(/\d+(?:\.\d+)?/g)];
  if (values.length !== 1) return null;
  if (!unitOptional && !new RegExp(`(?:^|\\s)${unit}(?:\\s|$)`, 'iu').test(lines[0][1])) return null;
  return Number(values[0][0]);
}

export function parseNutritionLabel(text) {
  if (typeof text !== 'string') throw new TypeError('OCR text must be a string');

  const amount = oneMatch(
    text,
    /(?:총\s*내용량|1회\s*제공량|serving\s*size)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(g|ml)\b/giu,
    (match) => ({ value: Number(match[1]), unit: match[2].toLowerCase() === 'ml' ? 'mL' : 'g' }),
  );
  return {
    ...EMPTY_RESULT,
    amount: amount?.value ?? null,
    amountUnit: amount?.unit ?? null,
    kcal: oneLineValue(text, '열량', 'kcal') ?? oneLineValue(text, 'calories?', 'kcal', { unitOptional: true }) ?? null,
    carbG: oneLineValue(text, '탄수화물|carbohydrates?', 'g') ?? null,
    proteinG: oneLineValue(text, '단백질|protein', 'g') ?? null,
    fatG: oneLineValue(text, '지방|fat', 'g') ?? null,
  };
}
