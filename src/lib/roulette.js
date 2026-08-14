import { sumEntries } from './dayTotals.js';
import { resolveServing } from './mfdsParser.js';
import { scaleNutrients } from './units.js';

const NUTRIENT_KEYS = ['kcal', 'carbG', 'proteinG', 'fatG'];
const SLOT_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];
const ZERO_MACROS = { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 };

export const SLOT_RATIOS = { breakfast: 25, lunch: 35, dinner: 30, snack: 10 };
export const RECENCY_WEIGHT = 0.2;

function formatValue(value) {
  return Number.isNaN(value) ? 'NaN' : JSON.stringify(value);
}

function validateMacros(macros, functionName, argumentName) {
  if (typeof macros !== 'object' || macros === null) {
    throw new TypeError(
      `${functionName}: ${argumentName} must be an object, got ${formatValue(macros)}`,
    );
  }

  for (const field of NUTRIENT_KEYS) {
    const value = macros[field];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new TypeError(
        `${functionName}: ${argumentName}.${field} must be a number, got ${formatValue(value)}`,
      );
    }
  }
}

function roundMacro(field, value) {
  return field === 'kcal' ? Math.round(value) : Math.round(value * 10) / 10;
}

export function createSeededRandom(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError(`createSeededRandom: seed must be a finite number, got ${JSON.stringify(seed)}`);
  }
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeSlotTargets(remainingMacros, emptySlots) {
  validateMacros(remainingMacros, 'computeSlotTargets', 'remainingMacros');
  if (!Array.isArray(emptySlots)) {
    throw new TypeError(
      `computeSlotTargets: emptySlots must be an array, got ${formatValue(emptySlots)}`,
    );
  }

  for (const slot of emptySlots) {
    if (!SLOT_KEYS.includes(slot)) {
      throw new Error(`computeSlotTargets: unknown slot ${formatValue(slot)}`);
    }
  }
  if (new Set(emptySlots).size !== emptySlots.length) {
    throw new Error('computeSlotTargets: emptySlots must not contain duplicates');
  }

  if (emptySlots.length === 0) return {};

  const ratioTotal = emptySlots.reduce((total, slot) => total + SLOT_RATIOS[slot], 0);
  const targets = {};

  for (const slot of emptySlots) {
    const ratio = SLOT_RATIOS[slot] / ratioTotal;
    targets[slot] = Object.fromEntries(
      NUTRIENT_KEYS.map((field) => [field, roundMacro(field, remainingMacros[field] * ratio)]),
    );
  }

  return targets;
}

export function scoreCombo(comboMacros, target) {
  validateMacros(comboMacros, 'scoreCombo', 'comboMacros');
  validateMacros(target, 'scoreCombo', 'target');

  return NUTRIENT_KEYS.reduce((score, field) => {
    const actual = comboMacros[field];
    const targetValue = target[field];
    const relativeError = targetValue > 0
      ? (actual - targetValue) / targetValue
      : (actual > 0 ? 1 : 0);
    return score + relativeError ** 2;
  }, 0);
}

function combinationsOfSize(candidates, size) {
  const combinations = [];

  function visit(startIndex, selected) {
    if (selected.length === size) {
      combinations.push(selected);
      return;
    }

    const remainingNeeded = size - selected.length;
    for (
      let index = startIndex;
      index <= candidates.length - remainingNeeded;
      index += 1
    ) {
      visit(index + 1, [...selected, candidates[index]]);
    }
  }

  visit(0, []);
  return combinations;
}

export function capCandidatePoolSize(candidates, target, maxSize) {
  if (!Number.isInteger(maxSize) || maxSize <= 0) {
    throw new TypeError(
      `capCandidatePoolSize: maxSize must be a positive integer, got ${formatValue(maxSize)}`,
    );
  }
  validateMacros(target, 'capCandidatePoolSize', 'target');

  if (candidates.length <= maxSize) return candidates;

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      distance: Math.abs(candidate.macros.kcal - target.kcal),
    }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .slice(0, maxSize)
    .map(({ candidate }) => candidate);
}

export function rankSlotCombos(candidates, target, maxItemsPerSlot) {
  if (!Number.isInteger(maxItemsPerSlot) || maxItemsPerSlot < 0) {
    throw new Error(
      `rankSlotCombos: maxItemsPerSlot must be a non-negative integer, got ${formatValue(maxItemsPerSlot)}`,
    );
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError(
      `rankSlotCombos: candidates must be an array, got ${formatValue(candidates)}`,
    );
  }

  const ranked = [];
  const maximumSize = Math.min(maxItemsPerSlot, candidates.length);

  for (let size = 0; size <= maximumSize; size += 1) {
    for (const selected of combinationsOfSize(candidates, size)) {
      const macros = size === 0
        ? { ...ZERO_MACROS }
        : sumEntries(selected.map((item) => item.macros));
      const recencyPenalty = selected.reduce(
        (total, item) => total + item.recencyPenalty,
        0,
      );

      ranked.push({
        entries: selected.flatMap((item) => item.entries),
        macros,
        score: scoreCombo(macros, target) + recencyPenalty,
        comboIds: selected.map((item) => item.id),
        order: ranked.length,
      });
    }
  }

  ranked.sort((left, right) => left.score - right.score || left.order - right.order);
  return ranked.map(({ order, ...combination }) => combination);
}

export function buildCandidatePool(presets, recentEntries) {
  if (!Array.isArray(presets)) {
    throw new TypeError(`buildCandidatePool: presets must be an array, got ${formatValue(presets)}`);
  }
  if (!Array.isArray(recentEntries)) {
    throw new TypeError(
      `buildCandidatePool: recentEntries must be an array, got ${formatValue(recentEntries)}`,
    );
  }

  const presetCandidates = presets.map((preset) => ({
    id: `preset_${preset.id}`,
    label: preset.label,
    entries: preset.entries,
    macros: sumEntries(preset.entries),
    recencyPenalty: 0,
  }));
  const recentCount = recentEntries.length;
  const recentCandidates = recentEntries.map((recentEntry, index) => ({
    id: `recent_${index}`,
    label: recentEntry.name,
    entries: [recentEntry],
    macros: sumEntries([recentEntry]),
    recencyPenalty: recentCount > 0
      ? RECENCY_WEIGHT * (1 - index / recentCount)
      : 0,
  }));

  return [...presetCandidates, ...recentCandidates];
}

export function buildCachedFoodCandidates(cachedFoods) {
  if (!Array.isArray(cachedFoods)) {
    throw new TypeError(
      `buildCachedFoodCandidates: cachedFoods must be an array, got ${formatValue(cachedFoods)}`,
    );
  }

  const candidates = [];

  for (const food of cachedFoods) {
    const serving = resolveServing(food);
    if (serving === null) continue;

    const scaled = scaleNutrients(food.per100g, serving.amount);
    if (NUTRIENT_KEYS.some((field) => scaled[field] === null)) continue;

    candidates.push({
      id: `cache_${food.foodKey}`,
      label: food.name,
      entries: [{
        name: food.name,
        foodKey: food.foodKey,
        amountG: serving.amount,
        kcal: scaled.kcal,
        carbG: scaled.carbG,
        proteinG: scaled.proteinG,
        fatG: scaled.fatG,
      }],
      macros: scaled,
      recencyPenalty: 0,
    });
  }

  return candidates;
}

export function pickFromTopK(rankedCombos, k, random) {
  if (!Array.isArray(rankedCombos) || rankedCombos.length === 0) {
    throw new Error('pickFromTopK: rankedCombos must not be empty');
  }
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error(`pickFromTopK: k must be a positive integer, got ${formatValue(k)}`);
  }

  const choiceCount = Math.min(k, rankedCombos.length);
  const index = Math.floor(random() * choiceCount);
  return rankedCombos[index];
}

export function buildRouletteProposal({
  remainingMacros,
  emptySlots,
  candidatePool,
  dislikes,
  seed,
  maxItemsPerSlot = 3,
  topK = 5,
  maxCandidatePoolSize = 30,
}) {
  validateMacros(remainingMacros, 'buildRouletteProposal', 'remainingMacros');
  if (remainingMacros.kcal <= 0) {
    return { ok: false, reason: 'over-budget' };
  }
  if (emptySlots.length === 0) {
    return { ok: false, reason: 'no-empty-slots' };
  }

  createSeededRandom(seed);
  const excludedFoodKeys = dislikes ?? [];
  const filteredCandidates = candidatePool.filter((item) =>
    !item.entries.some((candidateEntry) => excludedFoodKeys.includes(candidateEntry.foodKey)));
  const targets = computeSlotTargets(remainingMacros, emptySlots);
  const orderedEmptySlots = SLOT_KEYS.filter((slot) => emptySlots.includes(slot));
  const slots = {};
  let filledSlotCount = 0;

  for (const slot of orderedEmptySlots) {
    const slotIndex = SLOT_KEYS.indexOf(slot);
    const cappedCandidates = capCandidatePoolSize(
      filteredCandidates,
      targets[slot],
      maxCandidatePoolSize,
    );
    const ranked = rankSlotCombos(cappedCandidates, targets[slot], maxItemsPerSlot);
    const slotSeed = (seed + slotIndex * 2654435761) >>> 0;
    const picked = pickFromTopK(ranked, topK, createSeededRandom(slotSeed));

    slots[slot] = {
      entries: picked.entries,
      macros: picked.macros,
      targetMacros: targets[slot],
      score: picked.score,
    };
    if (picked.entries.length > 0) filledSlotCount += 1;
  }

  return { ok: true, slots, filledSlotCount };
}
