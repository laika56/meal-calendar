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

test('recent entry deletion builds an atomic array removal update', async () => {
  const recentEntries = await import('../src/lib/recentEntries.js');
  assert.equal(typeof recentEntries.recentEntryRemovalUpdate, 'function');

  const entry = { name: '긴 바코드 제품명', kcal: 210 };
  const atomicValue = Symbol('array-remove');
  const update = recentEntries.recentEntryRemovalUpdate(entry, (received) => {
    assert.equal(received, entry);
    return atomicValue;
  });

  assert.deepEqual(update, { recentEntries: atomicValue });
});

test('removing one rendered recent chip keeps the list visible while items remain', async () => {
  const recentEntries = await import('../src/lib/recentEntries.js');
  assert.equal(typeof recentEntries.removeRecentChip, 'function');

  const container = { childElementCount: 3 };
  const section = { hidden: false };
  const chip = {
    remove() {
      container.childElementCount -= 1;
    },
  };

  recentEntries.removeRecentChip(chip, container, section);

  assert.equal(container.childElementCount, 2);
  assert.equal(section.hidden, false);
});

test('removing the last rendered recent chip hides the empty section', async () => {
  const recentEntries = await import('../src/lib/recentEntries.js');
  const container = { childElementCount: 1 };
  const section = { hidden: false };
  const chip = {
    remove() {
      container.childElementCount -= 1;
    },
  };

  recentEntries.removeRecentChip(chip, container, section);

  assert.equal(container.childElementCount, 0);
  assert.equal(section.hidden, true);
});
