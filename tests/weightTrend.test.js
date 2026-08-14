import assert from 'node:assert/strict';
import test from 'node:test';

import {
  movingAverageKg,
  summarizeWeightTrend,
  weeklyChangeKg,
} from '../src/lib/weightTrend.js';

function point(date, weightKg) {
  return { date, weightKg };
}

const trendCalls = [
  ['movingAverageKg', (points) => movingAverageKg(points, 7)],
  ['weeklyChangeKg', (points) => weeklyChangeKg(points)],
  ['summarizeWeightTrend', (points) => summarizeWeightTrend(points)],
];

test('movingAverageKg returns an empty array for no samples', () => {
  assert.deepEqual(movingAverageKg([], 7), []);
});

test('movingAverageKg returns one output for one sample', () => {
  assert.deepEqual(movingAverageKg([point('2026-08-01', 70)], 7), [
    { date: '2026-08-01', avgKg: 70, sampleCount: 1 },
  ]);
});

test('movingAverageKg averages consecutive samples and rounds to one decimal place', () => {
  assert.deepEqual(
    movingAverageKg([
      point('2026-08-01', 70),
      point('2026-08-02', 70.1),
    ], 7),
    [
      { date: '2026-08-01', avgKg: 70, sampleCount: 1 },
      { date: '2026-08-02', avgKg: 70.1, sampleCount: 2 },
    ],
  );
});

test('movingAverageKg excludes a sample immediately outside the inclusive window', () => {
  assert.deepEqual(
    movingAverageKg([
      point('2026-08-01', 70),
      point('2026-08-08', 72),
    ], 7),
    [
      { date: '2026-08-01', avgKg: 70, sampleCount: 1 },
      { date: '2026-08-08', avgKg: 72, sampleCount: 1 },
    ],
  );
});

test('movingAverageKg sorts reverse-ordered input before calculating windows', () => {
  assert.deepEqual(
    movingAverageKg([
      point('2026-08-02', 72),
      point('2026-08-01', 70),
    ], 7),
    [
      { date: '2026-08-01', avgKg: 70, sampleCount: 1 },
      { date: '2026-08-02', avgKg: 71, sampleCount: 2 },
    ],
  );
});

test('movingAverageKg skips missing dates and counts only measured samples', () => {
  assert.deepEqual(
    movingAverageKg([
      point('2026-08-01', 70),
      point('2026-08-03', 72),
      point('2026-08-08', 74),
    ], 7),
    [
      { date: '2026-08-01', avgKg: 70, sampleCount: 1 },
      { date: '2026-08-03', avgKg: 71, sampleCount: 2 },
      { date: '2026-08-08', avgKg: 73, sampleCount: 2 },
    ],
  );
});

test('movingAverageKg with a one-day window uses only the current date', () => {
  assert.deepEqual(
    movingAverageKg([
      point('2026-08-01', 70),
      point('2026-08-02', 72),
    ], 1),
    [
      { date: '2026-08-01', avgKg: 70, sampleCount: 1 },
      { date: '2026-08-02', avgKg: 72, sampleCount: 1 },
    ],
  );
});

test('movingAverageKg uses the later duplicate as the corrected value', () => {
  assert.deepEqual(
    movingAverageKg([
      point('2026-08-02', 72),
      point('2026-08-01', 70),
      point('2026-08-01', 71),
    ], 7),
    [
      { date: '2026-08-01', avgKg: 71, sampleCount: 1 },
      { date: '2026-08-02', avgKg: 71.5, sampleCount: 2 },
    ],
  );
});

test('movingAverageKg rejects a non-integer or less-than-one window', () => {
  for (const windowDays of [0, -1, 1.5, '7', NaN]) {
    assert.throws(
      () => movingAverageKg([], windowDays),
      (error) => error instanceof Error && error.message.includes(String(windowDays)),
    );
  }
});

test('all trend functions reject a non-array points argument with TypeError', () => {
  for (const [name, call] of trendCalls) {
    assert.throws(
      () => call(null),
      (error) => error instanceof TypeError && error.message.includes('null'),
      name,
    );
  }
});

test('all trend functions reject a non-object point with TypeError', () => {
  for (const [name, call] of trendCalls) {
    assert.throws(
      () => call([null]),
      (error) => error instanceof TypeError && error.message.includes('null'),
      name,
    );
  }
});

test('all trend functions reject a malformed date and report its value', () => {
  for (const [name, call] of trendCalls) {
    assert.throws(
      () => call([point('2026-8-01', 70)]),
      (error) =>
        error.constructor === Error && error.message.includes('2026-8-01'),
      name,
    );
  }
});

test('all trend functions reject a non-number weight with TypeError', () => {
  for (const [name, call] of trendCalls) {
    assert.throws(
      () => call([point('2026-08-01', '70')]),
      (error) => error instanceof TypeError && error.message.includes('70'),
      name,
    );
  }
});

test('all trend functions reject NaN and report the literal NaN', () => {
  for (const [name, call] of trendCalls) {
    assert.throws(
      () => call([point('2026-08-01', NaN)]),
      (error) =>
        error.constructor === Error && error.message.includes('NaN'),
      name,
    );
  }
});

test('all trend functions reject zero and negative weights', () => {
  for (const weightKg of [0, -1]) {
    for (const [name, call] of trendCalls) {
      assert.throws(
        () => call([point('2026-08-01', weightKg)]),
        (error) =>
          error.constructor === Error && error.message.includes(String(weightKg)),
        `${name}: ${weightKg}`,
      );
    }
  }
});

test('weeklyChangeKg returns null for zero or one sample', () => {
  assert.equal(weeklyChangeKg([]), null);
  assert.equal(weeklyChangeKg([point('2026-08-01', 70)]), null);
});

test('weeklyChangeKg returns null when duplicate corrections leave a zero-day span', () => {
  assert.equal(
    weeklyChangeKg([
      point('2026-08-01', 70),
      point('2026-08-01', 72),
    ]),
    null,
  );
});

test('weeklyChangeKg returns minus one for a one-kilogram change over seven days', () => {
  assert.deepEqual(
    weeklyChangeKg([
      point('2026-08-01', 70),
      point('2026-08-08', 69),
    ]),
    { kgPerWeek: -1, spanDays: 7, sampleCount: 2 },
  );
});

test('weeklyChangeKg returns minus one for a two-kilogram change over fourteen days', () => {
  assert.deepEqual(
    weeklyChangeKg([
      point('2026-08-01', 70),
      point('2026-08-15', 68),
    ]),
    { kgPerWeek: -1, spanDays: 14, sampleCount: 2 },
  );
});

test('weeklyChangeKg returns numeric zero, not null, when every weight is equal', () => {
  const result = weeklyChangeKg([
    point('2026-08-01', 70),
    point('2026-08-08', 70),
  ]);

  assert.notEqual(result, null);
  assert.deepEqual(result, { kgPerWeek: 0, spanDays: 7, sampleCount: 2 });
});

test('weeklyChangeKg uses least-squares regression across every sample', () => {
  assert.deepEqual(
    weeklyChangeKg([
      point('2026-08-15', 68),
      point('2026-08-01', 70),
      point('2026-08-02', 72),
    ]),
    { kgPerWeek: -1.49, spanDays: 14, sampleCount: 3 },
  );
});

test('weeklyChangeKg uses the later duplicate correction in the regression', () => {
  assert.deepEqual(
    weeklyChangeKg([
      point('2026-08-01', 70),
      point('2026-08-08', 72),
      point('2026-08-08', 69),
    ]),
    { kgPerWeek: -1, spanDays: 7, sampleCount: 2 },
  );
});

test('summarizeWeightTrend reports an unknown empty trend with no latest sample', () => {
  assert.deepEqual(summarizeWeightTrend([]), {
    direction: 'unknown',
    kgPerWeek: null,
    spanDays: null,
    sampleCount: 0,
    latestKg: null,
    latestDate: null,
  });
});

test('summarizeWeightTrend reports an unknown one-sample trend and its latest value', () => {
  assert.deepEqual(summarizeWeightTrend([point('2026-08-01', 70)]), {
    direction: 'unknown',
    kgPerWeek: null,
    spanDays: null,
    sampleCount: 1,
    latestKg: 70,
    latestDate: '2026-08-01',
  });
});

test('summarizeWeightTrend includes the negative default threshold in down', () => {
  assert.deepEqual(
    summarizeWeightTrend([
      point('2026-08-01', 70),
      point('2026-08-08', 69.9),
    ]),
    {
      direction: 'down',
      kgPerWeek: -0.1,
      spanDays: 7,
      sampleCount: 2,
      latestKg: 69.9,
      latestDate: '2026-08-08',
    },
  );
});

test('summarizeWeightTrend includes the positive default threshold in up', () => {
  assert.equal(
    summarizeWeightTrend([
      point('2026-08-01', 70),
      point('2026-08-08', 70.1),
    ]).direction,
    'up',
  );
});

test('summarizeWeightTrend reports flat strictly inside the default thresholds', () => {
  assert.deepEqual(
    summarizeWeightTrend([
      point('2026-08-08', 70.09),
      point('2026-08-01', 70),
    ]),
    {
      direction: 'flat',
      kgPerWeek: 0.09,
      spanDays: 7,
      sampleCount: 2,
      latestKg: 70.09,
      latestDate: '2026-08-08',
    },
  );
});

test('summarizeWeightTrend applies a custom flat threshold', () => {
  assert.equal(
    summarizeWeightTrend(
      [point('2026-08-01', 70), point('2026-08-08', 70.1)],
      { flatThresholdKgPerWeek: 0.2 },
    ).direction,
    'flat',
  );
});

test('summarizeWeightTrend uses the later duplicate as the latest correction', () => {
  assert.deepEqual(
    summarizeWeightTrend([
      point('2026-08-08', 72),
      point('2026-08-01', 70),
      point('2026-08-08', 69),
    ]),
    {
      direction: 'down',
      kgPerWeek: -1,
      spanDays: 7,
      sampleCount: 2,
      latestKg: 69,
      latestDate: '2026-08-08',
    },
  );
});

test('summarizeWeightTrend rejects a non-number, NaN, or negative threshold', () => {
  for (const flatThresholdKgPerWeek of ['0.1', NaN, -0.1]) {
    assert.throws(
      () => summarizeWeightTrend([], { flatThresholdKgPerWeek }),
      (error) =>
        error.constructor === Error &&
        error.message.includes(String(flatThresholdKgPerWeek)),
    );
  }
});
