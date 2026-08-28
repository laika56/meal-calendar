import assert from 'node:assert/strict';
import test from 'node:test';

test('removing one recent item keeps the other saved shortcuts', async () => {
  const recentEntries = await import('../src/lib/recentEntries.js').catch(() => ({}));
  assert.equal(typeof recentEntries.withoutRecentEntry, 'function');

  const current = [
    { name: '감동란', kcal: 138 },
    { name: '서울우유', kcal: 130 },
    { name: '현미밥', kcal: 210 },
  ];

  assert.deepEqual(recentEntries.withoutRecentEntry(current, '서울우유'), [
    { name: '감동란', kcal: 138 },
    { name: '현미밥', kcal: 210 },
  ]);
  assert.equal(current.length, 3, 'the saved array must not be mutated');
});
