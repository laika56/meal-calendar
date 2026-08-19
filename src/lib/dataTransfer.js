const ROOT_KEYS = ['schema', 'version', 'exportedAt', 'profile', 'goals', 'days', 'presets', 'dislikes', 'recentEntries'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
const PROFILE_KEYS = ['sex', 'heightCm', 'weightKg', 'birthYear', 'weeklyWorkouts', 'goal', 'nickname'];
const GOAL_KEYS = ['effectiveFrom', 'bmr', 'tdee', 'kcal', 'proteinG', 'fatG', 'carbG', 'mode'];
const DAY_KEYS = ['date', 'slots', 'totals', 'weightKg'];
const TOTAL_KEYS = ['kcal', 'carbG', 'proteinG', 'fatG'];
const PRESET_KEYS = ['id', 'schemaVersion', 'label', 'kind', 'sourceSlot', 'slots', 'createdAt', 'entry', 'entries'];
const ENTRY_KEYS = [
  'foodKey', 'name', 'amountG', 'kcal', 'carbG', 'proteinG', 'fatG', 'addedBy', 'at',
  'estimate', 'matchedFoodName', 'source', 'barcode', 'nutritionProvenance', 'revisions',
];
const ESTIMATE_KEYS = ['displayAmount', 'source', 'sourceLabel'];
const REVISION_KEYS = ['changedAt', 'reason', 'before'];

function clone(value) {
  return structuredClone(value);
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`duplicate ${label}`);
}

function validateDate(value) {
  if (!DATE_RE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`invalid date: ${value}`);
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function closed(value, keys, label) {
  plainObject(value, label);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`unknown ${label} field: ${key}`);
}

function finite(value, label, { nullable = false, positive = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) throw new TypeError(`${label} must be a valid number`);
}

function timestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp`);
}

function validateEntry(entry, label = 'entry') {
  closed(entry, ENTRY_KEYS, label);
  if (typeof entry.name !== 'string' || !entry.name.trim()) throw new TypeError(`${label} name must be non-empty`);
  if ('foodKey' in entry && (typeof entry.foodKey !== 'string' || !entry.foodKey)) throw new TypeError(`${label} foodKey must be non-empty`);
  for (const key of ['amountG', 'kcal']) if (key in entry) finite(entry[key], `${label} ${key}`, { positive: key === 'amountG' });
  for (const key of ['carbG', 'proteinG', 'fatG']) if (key in entry) finite(entry[key], `${label} ${key}`, { nullable: true });
  for (const key of ['addedBy', 'matchedFoodName', 'source', 'barcode']) {
    if (key in entry && (typeof entry[key] !== 'string' || !entry[key])) throw new TypeError(`${label} ${key} must be non-empty`);
  }
  if ('at' in entry) timestamp(entry.at, `${label} at`);
  if ('estimate' in entry) {
    closed(entry.estimate, ESTIMATE_KEYS, `${label} estimate`);
    for (const key of Object.keys(entry.estimate)) {
      if (entry.estimate[key] !== null && typeof entry.estimate[key] !== 'string') throw new TypeError(`${label} estimate ${key} must be text or null`);
    }
  }
  if ('nutritionProvenance' in entry) {
    closed(entry.nutritionProvenance, TOTAL_KEYS, `${label} nutritionProvenance`);
    for (const value of Object.values(entry.nutritionProvenance)) {
      if (value !== null && typeof value !== 'string') throw new TypeError(`${label} nutritionProvenance values must be text or null`);
    }
  }
  if ('revisions' in entry) {
    if (!Array.isArray(entry.revisions)) throw new TypeError(`${label} revisions must be an array`);
    entry.revisions.forEach((revision, index) => {
      closed(revision, REVISION_KEYS, `${label} revision`);
      timestamp(revision.changedAt, `${label} revision changedAt`);
      if (!['amount', 'nutrition', 'identity'].includes(revision.reason)) throw new TypeError(`${label} revision reason is invalid`);
      validateEntry(revision.before, `${label} revision before ${index}`);
    });
  }
}

function validateSlots(slots, label) {
  closed(slots, SLOT_ORDER, `${label} slots`);
  for (const slot of SLOT_ORDER) {
    if (!Array.isArray(slots[slot])) throw new TypeError(`${label} ${slot} must be an array`);
    slots[slot].forEach((entry, index) => validateEntry(entry, `${label} ${slot}[${index}]`));
  }
}

function validateNestedRecords(value) {
  if (value.profile !== null) {
    closed(value.profile, PROFILE_KEYS, 'profile');
    for (const key of ['heightCm', 'weightKg', 'birthYear', 'weeklyWorkouts']) if (key in value.profile) finite(value.profile[key], `profile ${key}`, { positive: true });
  }
  value.goals.forEach((goal) => {
    closed(goal, GOAL_KEYS, 'goal');
    validateDate(goal.effectiveFrom);
    for (const key of ['bmr', 'tdee', 'kcal', 'proteinG', 'fatG', 'carbG']) if (key in goal) finite(goal[key], `goal ${key}`);
  });
  assertUnique(value.goals.map((goal) => goal.effectiveFrom), 'goal');
  value.days.forEach((day) => {
    closed(day, DAY_KEYS, 'day');
    validateDate(day.date);
    validateSlots(day.slots, `day ${day.date}`);
    closed(day.totals, TOTAL_KEYS, `day ${day.date} totals`);
    for (const key of TOTAL_KEYS) finite(day.totals[key], `day ${day.date} totals ${key}`);
    if ('weightKg' in day) finite(day.weightKg, `day ${day.date} weightKg`, { positive: true });
  });
  value.presets.forEach((preset) => {
    closed(preset, PRESET_KEYS, 'preset');
    if (typeof preset.label !== 'string') throw new TypeError('preset label must be text');
    if ('entry' in preset) validateEntry(preset.entry, 'preset entry');
    if ('entries' in preset) {
      if (!Array.isArray(preset.entries)) throw new TypeError('preset entries must be an array');
      preset.entries.forEach((entry, index) => validateEntry(entry, `preset entries[${index}]`));
    }
    if ('slots' in preset) validateSlots(preset.slots, 'preset');
    if ('createdAt' in preset && preset.createdAt !== null) timestamp(preset.createdAt, 'preset createdAt');
  });
  if (value.dislikes.some((item) => typeof item !== 'string' || !item)) throw new TypeError('dislike must be a non-empty string');
  value.recentEntries.forEach((entry, index) => validateEntry(entry, `recentEntries[${index}]`));
}

export function buildExportEnvelope(data, { exportedAt }) {
  const envelope = {
    schema: 'meal-calendar-export', version: 1, exportedAt,
    profile: clone(data.profile ?? null),
    goals: clone(data.goals ?? []).sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom))),
    days: clone(data.days ?? []).sort((a, b) => String(a.date).localeCompare(String(b.date))),
    presets: clone(data.presets ?? []).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    dislikes: clone(data.dislikes ?? []), recentEntries: clone(data.recentEntries ?? []),
  };
  return validateExportEnvelope(envelope);
}

export function validateExportEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('export root must be an object');
  for (const key of Object.keys(value)) if (!ROOT_KEYS.includes(key)) throw new TypeError(`unknown export root field: ${key}`);
  for (const key of ROOT_KEYS) if (!(key in value)) throw new TypeError(`missing export root field: ${key}`);
  if (value.schema !== 'meal-calendar-export' || value.version !== 1) throw new TypeError('unsupported export schema or version');
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) throw new TypeError('invalid exportedAt');
  for (const field of ['goals', 'days', 'presets', 'dislikes', 'recentEntries']) if (!Array.isArray(value[field])) throw new TypeError(`${field} must be an array`);
  const dayIds = value.days.map((day) => day?.date);
  dayIds.forEach(validateDate);
  assertUnique(dayIds, 'day');
  const presetIds = value.presets.map((preset) => preset?.id);
  if (presetIds.some((id) => typeof id !== 'string' || id === '')) throw new TypeError('preset id must be a non-empty string');
  assertUnique(presetIds, 'preset');
  validateNestedRecords(value);
  return clone(value);
}

export function serializeExportJson(envelope) {
  return `${JSON.stringify(validateExportEnvelope(envelope), null, 2)}\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeDaysCsv(days) {
  const rows = [['date', 'meal', 'name', 'amountG', 'kcal', 'carbG', 'proteinG', 'fatG', 'addedBy', 'estimated']];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const slot of SLOT_ORDER) {
      for (const entry of day.slots?.[slot] ?? []) rows.push([
        day.date, slot, entry.name, entry.amountG, entry.kcal,
        entry.carbG, entry.proteinG, entry.fatG, entry.addedBy,
        entry.estimate ? 'true' : 'false',
      ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function planMergeRestore(current, incoming) {
  const currentDays = new Set((current.days ?? []).map((day) => day.date));
  const currentPresets = new Set((current.presets ?? []).map((preset) => preset.id));
  const incomingDays = (incoming.days ?? []).map((day) => day.date).sort();
  const incomingPresets = (incoming.presets ?? []).map((preset) => preset.id).sort();
  return {
    daysToWrite: incomingDays.filter((id) => !currentDays.has(id)),
    presetsToWrite: incomingPresets.filter((id) => !currentPresets.has(id)),
    dayConflicts: incomingDays.filter((id) => currentDays.has(id)),
    presetConflicts: incomingPresets.filter((id) => currentPresets.has(id)),
  };
}
