export const NUTRIENT_FIELD_LABELS = {
  kcal: '칼로리',
  carbG: '탄수화물',
  proteinG: '단백질',
  fatG: '지방',
};

export function formNumber(data, field) {
  const value = data.get(field);
  return typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
}

export function buildPartialNutritionProvenance({ numericFields, source, fields }) {
  return {
    kcal: 'manual',
    carbG: 'manual',
    proteinG: 'manual',
    fatG: 'manual',
    ...Object.fromEntries(
      Object.entries(numericFields)
        .filter(([field, value]) => fields[field] === value)
        .map(([field]) => [field, source?.type ?? 'manual']),
    ),
    sourceUrl: source?.url ?? null,
    verifiedAt: source?.verifiedAt ?? null,
  };
}

/**
 * Move a partial search result into the visible manual form and focus the
 * first required missing nutrient after the panel handoff completes.
 */
export function showPartialNutritionEntry({ form, notice, food, amountG, scaled, showManualForm }) {
  form.reset();
  form.elements.name.value = food.name;
  form.elements.amountG.value = amountG;

  const numericFields = {};
  const missingFields = [];
  for (const [field, label] of Object.entries(NUTRIENT_FIELD_LABELS)) {
    if (Number.isFinite(scaled[field])) {
      form.elements[field].value = scaled[field];
      numericFields[field] = scaled[field];
    } else {
      missingFields.push({ field, label });
    }
  }

  notice.hidden = missingFields.length === 0;
  notice.textContent = missingFields.length > 0
    ? `공식 자료에 없는 ${missingFields.map(({ label }) => label).join('·')}은 직접 입력해야 합니다.`
    : '';
  showManualForm();

  // This runs after the portion panel becomes hidden, so keyboard users are
  // never left focused on an unavailable confirm button.
  (missingFields[0] ? form.elements[missingFields[0].field] : form.elements.name)?.focus();
  return { numericFields, missingFields: missingFields.map(({ field }) => field) };
}
