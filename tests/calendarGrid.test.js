import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonthGrid, dayStatus } from '../src/lib/calendarGrid.js';

test('starts with day 1 when the month begins on the configured week start', () => {
  const grid = buildMonthGrid({ year: 2021, month: 8 });

  assert.equal(grid.length, 35);
  assert.deepEqual(grid[0], {
    date: '2021-08-01',
    dayOfMonth: 1,
    weekday: 0,
    inCurrentMonth: true,
  });
  assert.deepEqual(grid.at(-1), {
    date: '2021-09-04',
    dayOfMonth: 4,
    weekday: 6,
    inCurrentMonth: false,
  });
});

test('prepends six dates when day 1 is immediately before the week start', () => {
  const grid = buildMonthGrid({ year: 2021, month: 5 });

  assert.equal(grid.length, 42);
  assert.deepEqual(grid[0], {
    date: '2021-04-25',
    dayOfMonth: 25,
    weekday: 0,
    inCurrentMonth: false,
  });
  assert.deepEqual(grid[6], {
    date: '2021-05-01',
    dayOfMonth: 1,
    weekday: 6,
    inCurrentMonth: true,
  });
  assert.equal(grid.at(-1).date, '2021-06-05');
});

test('keeps a four-week February grid at the required five rows', () => {
  const grid = buildMonthGrid({ year: 2026, month: 2 });

  assert.equal(grid.length, 35);
  assert.equal(grid[0].date, '2026-02-01');
  assert.deepEqual(grid.at(-1), {
    date: '2026-03-07',
    dayOfMonth: 7,
    weekday: 6,
    inCurrentMonth: false,
  });
});

test('includes February 29 in a leap year with the correct local date fields', () => {
  const grid = buildMonthGrid({ year: 2028, month: 2 });
  const currentMonthDates = grid.filter(({ inCurrentMonth }) => inCurrentMonth);

  assert.equal(currentMonthDates.length, 29);
  assert.deepEqual(currentMonthDates.at(-1), {
    date: '2028-02-29',
    dayOfMonth: 29,
    weekday: 2,
    inCurrentMonth: true,
  });
  assert.equal(grid[0].date, '2028-01-30');
  assert.equal(grid.at(-1).date, '2028-03-04');
});

test('keeps a common-year February at 28 current-month dates', () => {
  const grid = buildMonthGrid({ year: 2027, month: 2 });

  assert.equal(grid.filter(({ inCurrentMonth }) => inCurrentMonth).length, 28);
  assert.equal(grid.some(({ date }) => date === '2027-02-29'), false);
});

test('pads December with dates from January of the next year', () => {
  const grid = buildMonthGrid({ year: 2026, month: 12 });

  assert.equal(grid[0].date, '2026-11-29');
  assert.deepEqual(grid.at(-1), {
    date: '2027-01-02',
    dayOfMonth: 2,
    weekday: 6,
    inCurrentMonth: false,
  });
});

test('pads January with dates from December of the previous year', () => {
  const grid = buildMonthGrid({ year: 2026, month: 1 });

  assert.deepEqual(grid[0], {
    date: '2025-12-28',
    dayOfMonth: 28,
    weekday: 0,
    inCurrentMonth: false,
  });
  assert.equal(grid[4].date, '2026-01-01');
  assert.equal(grid.at(-1).date, '2026-01-31');
});

test('moves the same month grid when Monday is configured as the week start', () => {
  const sundayGrid = buildMonthGrid({ year: 2026, month: 8 });
  const mondayGrid = buildMonthGrid({ year: 2026, month: 8, weekStartsOn: 1 });

  assert.equal(sundayGrid[0].date, '2026-07-26');
  assert.equal(sundayGrid[0].weekday, 0);
  assert.equal(mondayGrid[0].date, '2026-07-27');
  assert.equal(mondayGrid[0].weekday, 1);
});

test('accepts the minimum and maximum supported years', () => {
  const minimumYear = buildMonthGrid({ year: 1, month: 1 });
  const maximumYear = buildMonthGrid({ year: 9999, month: 1 });

  assert.equal(minimumYear.find(({ inCurrentMonth }) => inCurrentMonth).date, '0001-01-01');
  assert.equal(maximumYear.find(({ inCurrentMonth }) => inCurrentMonth).date, '9999-01-01');
});

test('rejects invalid years with the specified RangeError messages', () => {
  const cases = [
    [undefined, 'undefined'],
    [NaN, 'NaN'],
    ['2026', '"2026"'],
    [2026.5, '2026.5'],
    [0, '0'],
    [-1, '-1'],
    [10000, '10000'],
  ];

  for (const [year, formatted] of cases) {
    assert.throws(
      () => buildMonthGrid({ year, month: 1 }),
      {
        name: 'RangeError',
        message: `buildMonthGrid: year must be an integer between 1 and 9999, got ${formatted}`,
      },
    );
  }
});

test('rejects invalid months with the specified RangeError messages', () => {
  const cases = [
    [undefined, 'undefined'],
    [NaN, 'NaN'],
    ['1', '"1"'],
    [1.5, '1.5'],
    [0, '0'],
    [-1, '-1'],
    [13, '13'],
  ];

  for (const [month, formatted] of cases) {
    assert.throws(
      () => buildMonthGrid({ year: 2026, month }),
      {
        name: 'RangeError',
        message: `buildMonthGrid: month must be an integer between 1 and 12, got ${formatted}`,
      },
    );
  }
});

test('rejects invalid week starts with the specified RangeError messages', () => {
  const cases = [
    [NaN, 'NaN'],
    ['0', '"0"'],
    [0.5, '0.5'],
    [-1, '-1'],
    [7, '7'],
  ];

  for (const [weekStartsOn, formatted] of cases) {
    assert.throws(
      () => buildMonthGrid({ year: 2026, month: 8, weekStartsOn }),
      {
        name: 'RangeError',
        message: `buildMonthGrid: weekStartsOn must be an integer between 0 and 6, got ${formatted}`,
      },
    );
  }
});

test('returns none before validating calorie values when there is no record', () => {
  assert.equal(dayStatus({ hasRecord: false }), 'none');
  assert.equal(dayStatus({ kcal: 'not a number', targetKcal: 0, hasRecord: false }), 'none');
});

test('classifies inclusive target boundaries and values immediately outside them', () => {
  const cases = [
    [{ kcal: 0, targetKcal: 100, hasRecord: true }, 'under'],
    [{ kcal: 89.999, targetKcal: 100, hasRecord: true }, 'under'],
    [{ kcal: 90, targetKcal: 100, hasRecord: true }, 'ok'],
    [{ kcal: 110, targetKcal: 100, hasRecord: true }, 'ok'],
    [{ kcal: 110.001, targetKcal: 100, hasRecord: true }, 'over'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(dayStatus(input), expected);
  }
});

test('rejects invalid recorded kcal values with the specified TypeError messages', () => {
  const cases = [
    [undefined, 'undefined'],
    [NaN, 'NaN'],
    ['0', '"0"'],
    [-0.1, '-0.1'],
  ];

  for (const [kcal, formatted] of cases) {
    assert.throws(
      () => dayStatus({ kcal, targetKcal: 100, hasRecord: true }),
      {
        name: 'TypeError',
        message: `dayStatus: kcal must be a non-negative number, got ${formatted}`,
      },
    );
  }
});

test('rejects invalid recorded targets with the specified TypeError messages', () => {
  const cases = [
    [undefined, 'undefined'],
    [NaN, 'NaN'],
    ['100', '"100"'],
    [0, '0'],
    [-0.1, '-0.1'],
  ];

  for (const [targetKcal, formatted] of cases) {
    assert.throws(
      () => dayStatus({ kcal: 100, targetKcal, hasRecord: true }),
      {
        name: 'TypeError',
        message: `dayStatus: targetKcal must be a positive number, got ${formatted}`,
      },
    );
  }
});
