# 음식 기록 수정 이력 구현 계획

**목표:** 기존 entry의 최신 표시를 유지하면서 변경 전 snapshot과 이유를 선택적 revisions에 보존한다.

**파일:** `src/lib/entryRevision.js`, `tests/entryRevision.test.js`, `public/app.js`, `public/index.html`, `tests/uiShell.test.js`.

## Task 1 — 순수 수정 함수

- [ ] RED: 기존 entry 호환, amount/nutrition/identity 이유, snapshot 닫힌 shape, 불변 `foodKey/addedBy/at`, 입력 nonmutation을 테스트한다.
- [ ] GREEN: `reviseEntry(entry,patch,{reason,changedAt})`와 `recalculateDayTotals(slots)`를 구현한다.

```js
const next = reviseEntry(entry, { amountG: 120, kcal: 240 }, {
  reason: 'amount', changedAt: '2026-08-19T12:00:00.000Z',
});
assert.equal(next.revisions.at(-1).before.amountG, entry.amountG);
assert.equal(next.foodKey, entry.foodKey);
```

## Task 2 — 편집·이력 UI

- [ ] RED: 편집 취소/검증 실패 저장 0, 성공 시 slots+totals 한 번 저장, 이력 읽기 전용 표시를 테스트한다.
- [ ] GREEN: 항목 행에 수정 진입점을 추가하고 기존 추가 UI의 양·영양 확인을 재사용한다. 최신값만 목록에 표시한다.
- [ ] 삭제와 수정 action의 접근 가능한 이름을 분리한다.
