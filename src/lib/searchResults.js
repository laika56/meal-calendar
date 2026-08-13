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
