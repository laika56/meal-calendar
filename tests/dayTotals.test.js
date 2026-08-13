import assert from 'node:assert/strict';
import test from 'node:test';

import { calcDayTotals, sumEntries, totalsMatch } from '../src/lib/dayTotals.js';

function entry(kcal, carbG, proteinG, fatG) {
  return { kcal, carbG, proteinG, fatG };
}

test('sumEntries returns zero totals for an empty slot', () => {
  assert.deepEqual(sumEntries([]), {
    kcal: 0,
    carbG: 0,
    proteinG: 0,
    fatG: 0,
  });
});

test('sumEntries preserves the nutrient values of one entry', () => {
  assert.deepEqual(sumEntries([entry(100, 10, 5, 2)]), {
    kcal: 100,
    carbG: 10,
    proteinG: 5,
    fatG: 2,
  });
});

test('sumEntries adds every nutrient field independently', () => {
  assert.deepEqual(
    sumEntries([
      entry(100, 1, 20, 3),
      entry(25, 4, 2, 10),
      entry(5, 10, 3, 1),
    ]),
    { kcal: 130, carbG: 15, proteinG: 25, fatG: 14 },
  );
});

test('sumEntries rounds once after adding all entries', () => {
  const entries = Array.from({ length: 3 }, () => entry(0.044, 0.056, 0.144, 0.156));

  assert.deepEqual(sumEntries(entries), {
    kcal: 0.1,
    carbG: 0.2,
    proteinG: 0.4,
    fatG: 0.5,
  });
});

test('sumEntries rejects a non-array input with the specified message', () => {
  const cases = [
    [undefined, 'undefined'],
    [null, 'null'],
    [{}, '{}'],
    ['entries', '"entries"'],
  ];

  for (const [entries, formatted] of cases) {
    assert.throws(
      () => sumEntries(entries),
      {
        name: 'TypeError',
        message: `sumEntries: entries must be an array, got ${formatted}`,
      },
    );
  }
});

test('sumEntries rejects null array elements with their index', () => {
  assert.throws(
    () => sumEntries([entry(1, 2, 3, 4), null]),
    {
      name: 'TypeError',
      message: 'sumEntries: entries[1] must be an object, got null',
    },
  );
});

test('sumEntries rejects undefined, null, NaN, and string nutrient fields', () => {
  const fields = ['kcal', 'carbG', 'proteinG', 'fatG'];
  const invalidValues = [
    [undefined, 'undefined'],
    [null, 'null'],
    [NaN, 'NaN'],
    ['1', '"1"'],
  ];

  for (const field of fields) {
    for (const [value, formatted] of invalidValues) {
      const invalidEntry = entry(1, 2, 3, 4);
      invalidEntry[field] = value;

      assert.throws(
        () => sumEntries([invalidEntry]),
        {
          name: 'TypeError',
          message: `sumEntries: entries[0].${field} must be a number, got ${formatted}`,
        },
      );
    }
  }
});

test('sumEntries rejects negative nutrient fields instead of clamping them', () => {
  const fields = ['kcal', 'carbG', 'proteinG', 'fatG'];

  for (const field of fields) {
    const invalidEntry = entry(1, 2, 3, 4);
    invalidEntry[field] = -0.1;

    assert.throws(
      () => sumEntries([invalidEntry]),
      {
        name: 'RangeError',
        message: `sumEntries: entries[0].${field} must not be negative, got -0.1`,
      },
    );
  }
});

test('sumEntries validates nutrient fields in the specified order', () => {
  assert.throws(
    () => sumEntries([{ kcal: 'bad', carbG: undefined, proteinG: NaN, fatG: -1 }]),
    {
      name: 'TypeError',
      message: 'sumEntries: entries[0].kcal must be a number, got "bad"',
    },
  );
});

test('calcDayTotals combines entries from all four slots', () => {
  const slots = {
    breakfast: [entry(10, 1, 2, 3)],
    lunch: [entry(20, 4, 5, 6)],
    dinner: [entry(30, 7, 8, 9)],
    snack: [entry(40, 10, 11, 12)],
  };

  assert.deepEqual(calcDayTotals(slots), {
    kcal: 100,
    carbG: 22,
    proteinG: 26,
    fatG: 30,
  });
});

test('calcDayTotals treats missing and undefined slots as empty', () => {
  assert.deepEqual(
    calcDayTotals({
      breakfast: [entry(10, 1, 2, 3)],
      lunch: undefined,
      snack: [entry(5, 4, 3, 2)],
    }),
    { kcal: 15, carbG: 5, proteinG: 5, fatG: 5 },
  );
});

test('calcDayTotals returns zero totals when every slot is empty', () => {
  assert.deepEqual(
    calcDayTotals({ breakfast: [], lunch: [], dinner: [], snack: [] }),
    { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 },
  );
});

test('calcDayTotals rounds once after combining all slots', () => {
  const tinyEntry = () => entry(0.024, 0.024, 0.024, 0.024);
  const slots = {
    breakfast: [tinyEntry()],
    lunch: [tinyEntry()],
    dinner: [tinyEntry()],
    snack: [tinyEntry()],
  };

  assert.deepEqual(calcDayTotals(slots), {
    kcal: 0.1,
    carbG: 0.1,
    proteinG: 0.1,
    fatG: 0.1,
  });
});

test('calcDayTotals ignores keys outside the four specified slots', () => {
  assert.deepEqual(
    calcDayTotals({ supper: 'not a slot', anotherField: null }),
    { kcal: 0, carbG: 0, proteinG: 0, fatG: 0 },
  );
});

test('calcDayTotals rejects a non-object slots input with the specified message', () => {
  const cases = [
    [undefined, 'undefined'],
    [null, 'null'],
    ['slots', '"slots"'],
    [1, '1'],
  ];

  for (const [slots, formatted] of cases) {
    assert.throws(
      () => calcDayTotals(slots),
      {
        name: 'TypeError',
        message: `calcDayTotals: slots must be an object, got ${formatted}`,
      },
    );
  }
});

test('calcDayTotals rejects non-array slot values with the specified message', () => {
  const cases = [
    ['breakfast', null, 'null'],
    ['lunch', {}, '{}'],
    ['dinner', 'entries', '"entries"'],
    ['snack', 1, '1'],
  ];

  for (const [key, value, formatted] of cases) {
    assert.throws(
      () => calcDayTotals({ [key]: value }),
      {
        name: 'TypeError',
        message: `calcDayTotals: slots.${key} must be an array, got ${formatted}`,
      },
    );
  }
});

test('calcDayTotals validates slots in the specified order', () => {
  assert.throws(
    () => calcDayTotals({ breakfast: null, lunch: {}, dinner: 'bad', snack: 1 }),
    {
      name: 'TypeError',
      message: 'calcDayTotals: slots.breakfast must be an array, got null',
    },
  );
});

test('totalsMatch returns true when all values are equal', () => {
  const totals = { kcal: 100, carbG: 10, proteinG: 5, fatG: 2 };

  assert.equal(totalsMatch(totals, { ...totals }), true);
});

test('totalsMatch accepts differences at and inside the 0.05 tolerance', () => {
  const totals = { kcal: 0, carbG: 10, proteinG: 5, fatG: 2 };

  assert.equal(
    totalsMatch(totals, { kcal: 0.05, carbG: 9.951, proteinG: 5, fatG: 2 }),
    true,
  );
});

test('totalsMatch rejects a 0.1 difference', () => {
  assert.equal(
    totalsMatch(
      { kcal: 100, carbG: 10, proteinG: 5, fatG: 2 },
      { kcal: 100.1, carbG: 10, proteinG: 5, fatG: 2 },
    ),
    false,
  );
});

test('totalsMatch rejects a difference in any one nutrient field', () => {
  const baseline = { kcal: 100, carbG: 10, proteinG: 5, fatG: 2 };

  for (const field of ['kcal', 'carbG', 'proteinG', 'fatG']) {
    assert.equal(totalsMatch(baseline, { ...baseline, [field]: baseline[field] + 0.1 }), false);
  }
});

test('totalsMatch returns false without throwing for invalid inputs', () => {
  const valid = { kcal: 100, carbG: 10, proteinG: 5, fatG: 2 };
  const invalidInputs = [
    undefined,
    null,
    'totals',
    { ...valid, kcal: undefined },
    { ...valid, carbG: '10' },
    { ...valid, proteinG: NaN },
  ];

  for (const invalid of invalidInputs) {
    assert.doesNotThrow(() => totalsMatch(valid, invalid));
    assert.equal(totalsMatch(valid, invalid), false);
    assert.doesNotThrow(() => totalsMatch(invalid, valid));
    assert.equal(totalsMatch(invalid, valid), false);
  }
});
