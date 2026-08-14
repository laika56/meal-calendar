import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECENCY_WEIGHT,
  SLOT_RATIOS,
  buildCachedFoodCandidates,
  buildCandidatePool,
  buildRouletteProposal,
  computeSlotTargets,
  createSeededRandom,
  pickFromTopK,
  rankSlotCombos,
  scoreCombo,
} from '../src/lib/roulette.js';

const ZERO_MACROS = { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 };
const COMBO_TARGET = { kcal: 250, carbG: 20, proteinG: 20, fatG: 8 };
const REMAINING_MACROS = { kcal: 800, carbG: 100, proteinG: 60, fatG: 20 };

function entry(name, foodKey, kcal, carbG, proteinG, fatG) {
  return { name, foodKey, kcal, carbG, proteinG, fatG };
}

function candidate(id, label, macros, recencyPenalty = 0, foodKey = id) {
  return {
    id,
    label,
    entries: [entry(label, foodKey, macros.kcal, macros.carbG, macros.proteinG, macros.fatG)],
    macros,
    recencyPenalty,
  };
}

function exampleCandidates() {
  return [
    candidate('A', '계란찜', { kcal: 150, carbG: 2, proteinG: 12, fatG: 10 }),
    candidate('B', '그릭요거트', { kcal: 100, carbG: 5, proteinG: 15, fatG: 2 }),
    candidate('D', '바나나', { kcal: 90, carbG: 23, proteinG: 1, fatG: 0 }),
  ];
}

function roundedScore(value) {
  return Number(value.toFixed(4));
}

const CACHED_DISH = {
  foodKey: 'mfds_D101-aaa',
  name: '김치찌개',
  per100g: { kcal: 46, carbG: 3, proteinG: 4, fatG: 2 },
  basis: 'g',
  foodGroup: 'dish',
  totalAmount: 230,
  totalUnit: 'g',
  servingAmount: null,
  servingUnit: null,
};

const UNKNOWN_SERVING_DISH = {
  foodKey: 'mfds_D101-bbb',
  name: '라멘_미소라멘',
  per100g: { kcal: 89, carbG: 11.4, proteinG: 4.6, fatG: 2.8 },
  basis: 'g',
  foodGroup: 'dish',
  totalAmount: 100,
  totalUnit: 'g',
  servingAmount: null,
  servingUnit: null,
};

const CACHED_PROCESSED_FOOD = {
  foodKey: 'mfds_P200-ccc',
  name: '그릭요거트',
  per100g: { kcal: 60, carbG: 4, proteinG: 10, fatG: 0.4 },
  basis: 'g',
  foodGroup: 'processed',
  totalAmount: 500,
  totalUnit: 'g',
  servingAmount: 30,
  servingUnit: 'g',
};

const INCOMPLETE_NUTRIENTS_FOOD = {
  foodKey: 'mfds_P200-ddd',
  name: '불명확 가공식품',
  per100g: { kcal: 120, carbG: 20, proteinG: 3, fatG: null },
  basis: 'g',
  foodGroup: 'processed',
  totalAmount: null,
  totalUnit: null,
  servingAmount: 50,
  servingUnit: 'g',
};

test('createSeededRandom returns values in the half-open unit interval', () => {
  const random = createSeededRandom(123);

  for (let index = 0; index < 100; index += 1) {
    const value = random();
    assert.ok(value >= 0);
    assert.ok(value < 1);
  }
});

test('createSeededRandom reproduces the same five-value sequence for the same seed', () => {
  const first = createSeededRandom(42);
  const second = createSeededRandom(42);

  assert.deepEqual(
    Array.from({ length: 5 }, () => first()),
    Array.from({ length: 5 }, () => second()),
  );
});

test('createSeededRandom produces different sequences for seeds one and two', () => {
  const first = createSeededRandom(1);
  const second = createSeededRandom(2);

  assert.notDeepEqual(
    Array.from({ length: 5 }, () => first()),
    Array.from({ length: 5 }, () => second()),
  );
});

test('createSeededRandom rejects every non-finite numeric seed', () => {
  for (const seed of [undefined, null, '1', NaN, Infinity, -Infinity]) {
    assert.throws(() => createSeededRandom(seed), TypeError);
  }
});

test('computeSlotTargets exports and applies the specified slot ratios', () => {
  assert.deepEqual(SLOT_RATIOS, { breakfast: 25, lunch: 35, dinner: 30, snack: 10 });
  assert.deepEqual(
    computeSlotTargets(
      REMAINING_MACROS,
      ['breakfast', 'snack'],
    ),
    {
      breakfast: { kcal: 571, carbG: 71.4, proteinG: 42.9, fatG: 14.3 },
      snack: { kcal: 229, carbG: 28.6, proteinG: 17.1, fatG: 5.7 },
    },
  );
});

test('computeSlotTargets returns no targets when there are no empty slots', () => {
  assert.deepEqual(
    computeSlotTargets(REMAINING_MACROS, []),
    {},
  );
});

test('computeSlotTargets assigns the whole remainder to one empty slot', () => {
  assert.deepEqual(
    computeSlotTargets(REMAINING_MACROS, ['dinner']),
    { dinner: REMAINING_MACROS },
  );
});

test('computeSlotTargets distributes all four slots without renormalizing away a slot', () => {
  assert.deepEqual(
    computeSlotTargets(
      REMAINING_MACROS,
      ['breakfast', 'lunch', 'dinner', 'snack'],
    ),
    {
      breakfast: { kcal: 200, carbG: 25, proteinG: 15, fatG: 5 },
      lunch: { kcal: 280, carbG: 35, proteinG: 21, fatG: 7 },
      dinner: { kcal: 240, carbG: 30, proteinG: 18, fatG: 6 },
      snack: { kcal: 80, carbG: 10, proteinG: 6, fatG: 2 },
    },
  );
});

test('computeSlotTargets keeps negative arithmetic instead of clamping it', () => {
  assert.deepEqual(
    computeSlotTargets(
      { kcal: -1, carbG: 0, proteinG: 0, fatG: 0 },
      ['breakfast'],
    ),
    { breakfast: { kcal: -1, carbG: 0, proteinG: 0, fatG: 0 } },
  );
});

test('computeSlotTargets rejects unknown slot keys', () => {
  assert.throws(
    () => computeSlotTargets(COMBO_TARGET, ['breakfast', 'supper']),
    Error,
  );
});

test('computeSlotTargets rejects duplicate slot keys instead of underallocating them', () => {
  assert.throws(
    () => computeSlotTargets(REMAINING_MACROS, ['breakfast', 'breakfast']),
    Error,
  );
});

test('computeSlotTargets rejects a non-number in every remaining macro field', () => {
  for (const field of ['kcal', 'carbG', 'proteinG', 'fatG']) {
    assert.throws(
      () => computeSlotTargets({ ...COMBO_TARGET, [field]: 'bad' }, ['lunch']),
      TypeError,
    );
  }
});

test('scoreCombo reproduces every hand-checked score from the order', () => {
  const cases = [
    [ZERO_MACROS, 4],
    [{ kcal: 150, carbG: 2, proteinG: 12, fatG: 10 }, 1.1925],
    [{ kcal: 250, carbG: 7, proteinG: 27, fatG: 12 }, 0.795],
    [{ kcal: 240, carbG: 25, proteinG: 13, fatG: 10 }, 0.2491],
    [{ kcal: 190, carbG: 28, proteinG: 16, fatG: 2 }, 0.8201],
  ];

  for (const [macros, expected] of cases) {
    assert.equal(roundedScore(scoreCombo(macros, COMBO_TARGET)), expected);
  }
});

test('scoreCombo gives a zero target no penalty only when actual is also zero', () => {
  assert.equal(scoreCombo(ZERO_MACROS, ZERO_MACROS), 0);
  assert.equal(scoreCombo({ ...ZERO_MACROS, proteinG: 1 }, ZERO_MACROS), 1);
});

test('scoreCombo rejects a non-number in either macro object', () => {
  for (const field of ['kcal', 'carbG', 'proteinG', 'fatG']) {
    assert.throws(
      () => scoreCombo({ ...COMBO_TARGET, [field]: undefined }, COMBO_TARGET),
      TypeError,
    );
    assert.throws(
      () => scoreCombo(COMBO_TARGET, { ...COMBO_TARGET, [field]: NaN }),
      TypeError,
    );
  }
});

test('rankSlotCombos returns all seven combinations in the specified score order', () => {
  const ranked = rankSlotCombos(exampleCandidates(), COMBO_TARGET, 2);

  assert.deepEqual(
    ranked.map(({ comboIds }) => comboIds),
    [['A', 'D'], ['A', 'B'], ['B', 'D'], ['A'], ['B'], ['D'], []],
  );
  assert.deepEqual(
    ranked.map(({ macros }) => macros),
    [
      { kcal: 240, carbG: 25, proteinG: 13, fatG: 10 },
      { kcal: 250, carbG: 7, proteinG: 27, fatG: 12 },
      { kcal: 190, carbG: 28, proteinG: 16, fatG: 2 },
      { kcal: 150, carbG: 2, proteinG: 12, fatG: 10 },
      { kcal: 100, carbG: 5, proteinG: 15, fatG: 2 },
      { kcal: 90, carbG: 23, proteinG: 1, fatG: 0 },
      ZERO_MACROS,
    ],
  );
  assert.deepEqual(
    ranked.map(({ score }) => roundedScore(score)),
    [0.2491, 0.795, 0.8201, 1.1925, 1.5475, 2.3346, 4],
  );
});

test('rankSlotCombos concatenates the entries for each selected candidate', () => {
  const candidates = exampleCandidates();
  const combination = rankSlotCombos(candidates, COMBO_TARGET, 2)
    .find(({ comboIds }) => comboIds.join(',') === 'A,D');

  assert.deepEqual(combination.entries, [candidates[0].entries[0], candidates[2].entries[0]]);
});

test('rankSlotCombos adds recency penalties directly to combination scores', () => {
  const [plain, penalized] = [
    candidate('plain', 'plain', COMBO_TARGET, 0),
    candidate('penalized', 'penalized', COMBO_TARGET, 0.2),
  ];
  const ranked = rankSlotCombos([penalized, plain], COMBO_TARGET, 1);

  assert.deepEqual(ranked.slice(0, 2).map(({ comboIds }) => comboIds), [['plain'], ['penalized']]);
  assert.equal(ranked[0].score, 0);
  assert.equal(ranked[1].score, 0.2);
});

test('rankSlotCombos preserves candidate order when scores are tied', () => {
  const macros = { kcal: 150, carbG: 2, proteinG: 12, fatG: 10 };
  const ranked = rankSlotCombos(
    [candidate('first', 'first', macros), candidate('second', 'second', macros)],
    COMBO_TARGET,
    1,
  );

  assert.deepEqual(ranked.slice(0, 2).map(({ comboIds }) => comboIds), [['first'], ['second']]);
});

test('rankSlotCombos returns only the empty combination at the zero boundary', () => {
  assert.deepEqual(rankSlotCombos(exampleCandidates(), COMBO_TARGET, 0), [
    { entries: [], macros: ZERO_MACROS, score: 4, comboIds: [] },
  ]);
  assert.deepEqual(rankSlotCombos([], COMBO_TARGET, 3), [
    { entries: [], macros: ZERO_MACROS, score: 4, comboIds: [] },
  ]);
});

test('rankSlotCombos rejects negative and non-integer maximum sizes', () => {
  for (const maximum of [-1, 1.5]) {
    assert.throws(() => rankSlotCombos([], COMBO_TARGET, maximum), Error);
  }
});

test('buildCandidatePool maps presets through sumEntries without a recency penalty', () => {
  const entries = [
    entry('계란찜', 'A', 150, 2, 12, 10),
    entry('그릭요거트', 'B', 100, 5, 15, 2),
  ];

  assert.deepEqual(buildCandidatePool([{ id: 'meal', label: '저장 조합', entries }], []), [
    {
      id: 'preset_meal',
      label: '저장 조합',
      entries,
      macros: { kcal: 250, carbG: 7, proteinG: 27, fatG: 12 },
      recencyPenalty: 0,
    },
  ]);
});

test('buildCandidatePool reproduces every specified recency penalty', () => {
  assert.equal(RECENCY_WEIGHT, 0.2);
  const recentEntries = Array.from({ length: 10 }, (_, index) =>
    entry(`최근 ${index}`, `recent-${index}`, 150, 2, 12, 10));
  const pool = buildCandidatePool([], recentEntries);

  assert.equal(pool[0].recencyPenalty, 0.2);
  assert.equal(pool[5].recencyPenalty, 0.1);
  assert.ok(Math.abs(pool[9].recencyPenalty - 0.02) < 1e-12);
  assert.equal(
    buildCandidatePool([], [entry('하나', 'one', 150, 2, 12, 10)])[0].recencyPenalty,
    0.2,
  );
  assert.deepEqual(pool[0], {
    id: 'recent_0',
    label: '최근 0',
    entries: [recentEntries[0]],
    macros: { kcal: 150, carbG: 2, proteinG: 12, fatG: 10 },
    recencyPenalty: 0.2,
  });
});

test('buildCandidatePool returns an empty pool for two empty sources', () => {
  assert.deepEqual(buildCandidatePool([], []), []);
});

test('buildCandidatePool rejects either source when it is not an array', () => {
  assert.throws(() => buildCandidatePool(null, []), TypeError);
  assert.throws(() => buildCandidatePool([], null), TypeError);
});

test('buildCachedFoodCandidates scales one known dish serving into one candidate', () => {
  assert.deepEqual(buildCachedFoodCandidates([CACHED_DISH]), [
    {
      id: 'cache_mfds_D101-aaa',
      label: '김치찌개',
      entries: [{
        name: '김치찌개',
        foodKey: 'mfds_D101-aaa',
        kcal: 105.8,
        carbG: 6.9,
        proteinG: 9.2,
        fatG: 4.6,
      }],
      macros: { kcal: 105.8, carbG: 6.9, proteinG: 9.2, fatG: 4.6 },
      recencyPenalty: 0,
    },
  ]);
});

test('buildCachedFoodCandidates omits food when resolveServing cannot determine a serving', () => {
  assert.deepEqual(buildCachedFoodCandidates([UNKNOWN_SERVING_DISH]), []);
});

test('buildCachedFoodCandidates omits a serving when any scaled nutrient is null', () => {
  assert.deepEqual(buildCachedFoodCandidates([INCOMPLETE_NUTRIENTS_FOOD]), []);
});

test('buildCachedFoodCandidates returns an empty list for an empty cache', () => {
  assert.deepEqual(buildCachedFoodCandidates([]), []);
});

test('buildCachedFoodCandidates rejects a non-array cache with the specified message', () => {
  assert.throws(
    () => buildCachedFoodCandidates(null),
    {
      name: 'TypeError',
      message: 'buildCachedFoodCandidates: cachedFoods must be an array, got null',
    },
  );
});

test('buildCachedFoodCandidates keeps only valid mixed items in their input order', () => {
  assert.deepEqual(
    buildCachedFoodCandidates([
      CACHED_DISH,
      UNKNOWN_SERVING_DISH,
      CACHED_PROCESSED_FOOD,
      INCOMPLETE_NUTRIENTS_FOOD,
    ]),
    [
      candidate(
        'cache_mfds_D101-aaa',
        '김치찌개',
        { kcal: 105.8, carbG: 6.9, proteinG: 9.2, fatG: 4.6 },
        0,
        'mfds_D101-aaa',
      ),
      candidate(
        'cache_mfds_P200-ccc',
        '그릭요거트',
        { kcal: 18, carbG: 1.2, proteinG: 3, fatG: 0.1 },
        0,
        'mfds_P200-ccc',
      ),
    ],
  );
});

test('pickFromTopK is reproducible for newly created random functions with the same seed', () => {
  const ranked = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];

  assert.strictEqual(
    pickFromTopK(ranked, 3, createSeededRandom(17)),
    pickFromTopK(ranked, 3, createSeededRandom(17)),
  );
});

test('pickFromTopK always returns an original member of the clamped top range', () => {
  const ranked = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
  const topTwoRandom = createSeededRandom(99);

  for (let index = 0; index < 20; index += 1) {
    assert.ok(ranked.slice(0, 2).includes(pickFromTopK(ranked, 2, topTwoRandom)));
  }

  const clampedRandom = createSeededRandom(101);
  for (let index = 0; index < 20; index += 1) {
    assert.ok(ranked.includes(pickFromTopK(ranked, 20, clampedRandom)));
  }
});

test('pickFromTopK rejects an empty ranking and invalid k values', () => {
  assert.throws(() => pickFromTopK([], 1, createSeededRandom(1)), Error);
  for (const k of [0, -1, 1.5]) {
    assert.throws(() => pickFromTopK([{ id: 0 }], k, createSeededRandom(1)), Error);
  }
});

test('buildRouletteProposal reports zero and negative kcal as over budget', () => {
  for (const kcal of [0, -1]) {
    assert.deepEqual(
      buildRouletteProposal({
        remainingMacros: { ...REMAINING_MACROS, kcal },
        emptySlots: ['breakfast'],
        candidatePool: [],
        dislikes: [],
        seed: 1,
      }),
      { ok: false, reason: 'over-budget' },
    );
  }
});

test('buildRouletteProposal reports when there are no empty slots', () => {
  assert.deepEqual(
    buildRouletteProposal({
      remainingMacros: COMBO_TARGET,
      emptySlots: [],
      candidatePool: [],
      dislikes: [],
      seed: 1,
    }),
    { ok: false, reason: 'no-empty-slots' },
  );
});

test('buildRouletteProposal removes a candidate when any entry is disliked', () => {
  const mixedCandidate = {
    id: 'mixed',
    label: '혼합',
    entries: [
      entry('계란찜', 'blocked', 150, 2, 12, 10),
      entry('그릭요거트', 'allowed', 100, 5, 15, 2),
    ],
    macros: { kcal: 250, carbG: 7, proteinG: 27, fatG: 12 },
    recencyPenalty: 0,
  };
  const safeCandidate = candidate(
    'safe',
    '바나나',
    { kcal: 90, carbG: 23, proteinG: 1, fatG: 0 },
    0,
    'safe-key',
  );
  const result = buildRouletteProposal({
    remainingMacros: COMBO_TARGET,
    emptySlots: ['breakfast'],
    candidatePool: [mixedCandidate, safeCandidate],
    dislikes: ['blocked'],
    seed: 4,
    maxItemsPerSlot: 1,
    topK: 1,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.slots.breakfast.entries, safeCandidate.entries);
  assert.ok(result.slots.breakfast.entries.every(({ foodKey }) => foodKey !== 'blocked'));
});

test('buildRouletteProposal succeeds with empty combinations when dislikes remove every candidate', () => {
  const result = buildRouletteProposal({
    remainingMacros: COMBO_TARGET,
    emptySlots: ['breakfast'],
    candidatePool: [candidate(
      'blocked',
      '계란찜',
      { kcal: 150, carbG: 2, proteinG: 12, fatG: 10 },
      0,
      'blocked-key',
    )],
    dislikes: ['blocked-key'],
    seed: 1,
  });

  assert.deepEqual(result, {
    ok: true,
    slots: {
      breakfast: {
        entries: [],
        macros: ZERO_MACROS,
        targetMacros: COMBO_TARGET,
        score: 4,
      },
    },
    filledSlotCount: 0,
  });
});

test('buildRouletteProposal succeeds with empty combinations when the pool is empty', () => {
  const result = buildRouletteProposal({
    remainingMacros: REMAINING_MACROS,
    emptySlots: ['breakfast', 'snack'],
    candidatePool: [],
    dislikes: [],
    seed: 7,
  });

  assert.deepEqual(result, {
    ok: true,
    slots: {
      breakfast: {
        entries: [],
        macros: ZERO_MACROS,
        targetMacros: { kcal: 571, carbG: 71.4, proteinG: 42.9, fatG: 14.3 },
        score: 4,
      },
      snack: {
        entries: [],
        macros: ZERO_MACROS,
        targetMacros: { kcal: 229, carbG: 28.6, proteinG: 17.1, fatG: 5.7 },
        score: 4,
      },
    },
    filledSlotCount: 0,
  });
});

test('buildRouletteProposal returns byte-for-byte reproducible data for the same seed', () => {
  const input = {
    remainingMacros: REMAINING_MACROS,
    emptySlots: ['breakfast', 'lunch', 'dinner', 'snack'],
    candidatePool: exampleCandidates(),
    dislikes: [],
    seed: 1234,
    maxItemsPerSlot: 2,
    topK: 5,
  };

  assert.equal(
    JSON.stringify(buildRouletteProposal(input)),
    JSON.stringify(buildRouletteProposal(input)),
  );
});

test('buildRouletteProposal emits slots in canonical order for one and four empty slots', () => {
  const base = {
    remainingMacros: REMAINING_MACROS,
    candidatePool: [],
    dislikes: [],
    seed: 10,
  };

  assert.deepEqual(
    Object.keys(buildRouletteProposal({ ...base, emptySlots: ['dinner'] }).slots),
    ['dinner'],
  );
  assert.deepEqual(
    Object.keys(buildRouletteProposal({
      ...base,
      emptySlots: ['snack', 'dinner', 'breakfast', 'lunch'],
    }).slots),
    ['breakfast', 'lunch', 'dinner', 'snack'],
  );
});

test('buildRouletteProposal leaves every slot empty when maxItemsPerSlot is zero', () => {
  const result = buildRouletteProposal({
    remainingMacros: REMAINING_MACROS,
    emptySlots: ['breakfast', 'lunch', 'dinner', 'snack'],
    candidatePool: exampleCandidates(),
    seed: 10,
    maxItemsPerSlot: 0,
    topK: 50,
  });

  assert.equal(result.ok, true);
  assert.equal(result.filledSlotCount, 0);
  assert.ok(Object.values(result.slots).every(({ entries }) => entries.length === 0));
});

test('buildRouletteProposal rejects duplicate empty slots', () => {
  assert.throws(
    () => buildRouletteProposal({
      remainingMacros: REMAINING_MACROS,
      emptySlots: ['breakfast', 'breakfast'],
      candidatePool: [],
      seed: 1,
    }),
    Error,
  );
});

test('buildRouletteProposal accepts an omitted dislikes list and topK above ranking length', () => {
  const result = buildRouletteProposal({
    remainingMacros: COMBO_TARGET,
    emptySlots: ['breakfast'],
    candidatePool: [candidate('only', '한 항목', COMBO_TARGET)],
    seed: 22,
    maxItemsPerSlot: 1,
    topK: 100,
  });

  assert.equal(result.ok, true);
  assert.ok([0, 1].includes(result.slots.breakfast.entries.length));
});

test('buildRouletteProposal rejects a non-number seed', () => {
  assert.throws(
    () => buildRouletteProposal({
      remainingMacros: COMBO_TARGET,
      emptySlots: ['breakfast'],
      candidatePool: [],
      dislikes: [],
      seed: '1',
    }),
    TypeError,
  );
});
