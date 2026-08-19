const REASONS = new Set(['amount', 'nutrition', 'identity']);
const IMMUTABLE_FIELDS = ['foodKey', 'addedBy', 'at'];
const SNAPSHOT_FIELDS = [
  'name', 'amountG', 'kcal', 'carbG', 'proteinG', 'fatG',
  'estimate', 'matchedFoodName', 'source', 'barcode', 'nutritionProvenance',
];

function clone(value) {
  return structuredClone(value);
}

function beforeSnapshot(entry) {
  return Object.fromEntries(
    SNAPSHOT_FIELDS
      .filter((field) => entry[field] !== undefined)
      .map((field) => [field, clone(entry[field])]),
  );
}

export function revisionReason(before, after) {
  if (before?.name !== after?.name) return 'identity';
  if (['kcal', 'carbG', 'proteinG', 'fatG'].some((field) => before?.[field] !== after?.[field])) return 'nutrition';
  if (before?.amountG !== after?.amountG) return 'amount';
  return null;
}

export function reviseEntry(entry, patch, { reason, changedAt }) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('entry must be an object');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object');
  if (!REASONS.has(reason)) throw new TypeError('reason must be amount, nutrition, or identity');
  if (typeof changedAt !== 'string' || Number.isNaN(Date.parse(changedAt))) throw new TypeError('changedAt must be an ISO timestamp');
  for (const field of IMMUTABLE_FIELDS) {
    if (field in patch && patch[field] !== entry[field]) throw new TypeError(`${field} is immutable`);
  }

  return {
    ...clone(entry),
    ...clone(patch),
    foodKey: entry.foodKey,
    addedBy: entry.addedBy,
    at: entry.at,
    revisions: [
      ...clone(entry.revisions ?? []),
      { changedAt, reason, before: beforeSnapshot(entry) },
    ],
  };
}
