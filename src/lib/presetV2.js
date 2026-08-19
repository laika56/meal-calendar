const SLOT_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];

function emptySlots() {
  return { breakfast: [], lunch: [], dinner: [], snack: [] };
}

function snapshotEntry(entry) {
  const copy = structuredClone(entry);
  delete copy.revisions;
  return copy;
}

function assertSlot(slot) {
  if (!SLOT_KEYS.includes(slot)) throw new TypeError('slot must be breakfast, lunch, dinner, or snack');
}

function snapshotSlots(slots) {
  return Object.fromEntries(SLOT_KEYS.map((slot) => [slot, (slots?.[slot] ?? []).map(snapshotEntry)]));
}

export function createMealPreset(label, sourceSlot, entries, { createdAt }) {
  assertSlot(sourceSlot);
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('meal preset entries must be non-empty');
  const slots = emptySlots();
  slots[sourceSlot] = entries.map(snapshotEntry);
  return { schemaVersion: 2, label, kind: 'meal', sourceSlot, slots, createdAt };
}

export function createDayPreset(label, slots, { createdAt }) {
  return { schemaVersion: 2, label, kind: 'day', sourceSlot: null, slots: snapshotSlots(slots), createdAt };
}

export function normalizePreset(preset) {
  if (preset?.schemaVersion === 2) return structuredClone(preset);
  const entries = preset?.entries ?? (preset?.entry ? [preset.entry] : []);
  return createMealPreset(preset?.label ?? '', 'lunch', entries, { createdAt: preset?.createdAt ?? null });
}

export function planPresetApply(rawPreset, currentSlots, { targetSlot, at }) {
  const preset = normalizePreset(rawPreset);
  const slots = snapshotSlots(currentSlots);
  const copyForApply = (entry) => ({ ...snapshotEntry(entry), at, addedBy: 'preset' });

  if (preset.kind === 'meal') {
    assertSlot(targetSlot);
    const entries = preset.slots[preset.sourceSlot] ?? [];
    slots[targetSlot] = [...slots[targetSlot], ...entries.map(copyForApply)];
  } else if (preset.kind === 'day') {
    for (const slot of SLOT_KEYS) slots[slot] = [...slots[slot], ...(preset.slots[slot] ?? []).map(copyForApply)];
  } else {
    throw new TypeError('preset kind must be meal or day');
  }

  return { slots, addedCount: SLOT_KEYS.reduce((sum, slot) => sum + slots[slot].length - (currentSlots?.[slot]?.length ?? 0), 0) };
}
