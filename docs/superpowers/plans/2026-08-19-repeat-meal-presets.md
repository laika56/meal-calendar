# 한 끼·하루 프리셋 구현 계획

**목표:** 기존 preset을 유지하며 meal/day v2 preset을 저장하고 독립 entry 복사본으로 적용한다.

**파일:** `src/lib/presetV2.js`, `tests/presetV2.test.js`, `public/db.js`, `public/app.js`, `public/index.html`, `tests/presetIntegration.test.js`.

## Task 1 — preset v2 순수 변환

- [ ] RED: meal/day 생성, slot 검증, revisions 제거, 기존 `entry`/`entries` 호환, deep-copy nonmutation을 테스트한다.
- [ ] GREEN: `createMealPreset`, `createDayPreset`, `normalizePreset`, `planPresetApply`를 구현한다.

```js
const applied = planPresetApply(preset, day, {
  targetSlot: 'lunch', at: '2026-08-19T03:00:00.000Z',
});
assert.equal(applied.slots.lunch.at(-1).addedBy, 'preset');
assert.equal('revisions' in applied.slots.lunch.at(-1), false);
```

## Task 2 — 저장·확인·적용 UI

- [ ] RED: 적용 전 날짜/개수 확인, 취소 저장 0, meal append, day slot별 append, 기존 preset 적용을 테스트한다.
- [ ] GREEN: 일간 상세에 한 끼/하루 저장을 추가하고 preset 목록에 종류를 표시한다. 적용은 계산 완료 후 `saveDay` 한 번만 호출한다.
