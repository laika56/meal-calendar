# 최근 7일 요약 구현 계획

**목표:** 선택일 포함 직전 7개 서울 날짜의 기록일 평균과 체중 관찰값만 보여준다.

**파일:** `src/lib/weeklySummary.js`, `tests/weeklySummary.test.js`, `public/db.js`, `public/app.js`, `public/index.html`, `tests/uiShell.test.js`.

## Task 1 — 날짜와 요약 계산

- [ ] RED: 0/1/7일, 월·연 경계, 기록 없는 날 제외, 체중 0/1/2회를 테스트한다.
- [ ] GREEN: `sevenDayKeys(endDate)`와 `summarizeSevenDays(days,endDate)`를 구현한다. 평균은 `totals.kcal>0`인 날만 사용한다.

```js
assert.deepEqual(sevenDayKeys('2026-09-02'), [
  '2026-08-27','2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02',
]);
```

## Task 2 — 범위 조회·sheet

- [ ] RED: 정확히 7개 본인 day 문서 조회, loading/empty/error 구분, 실패를 0으로 표시하지 않는 테스트를 쓴다.
- [ ] GREEN: `db.loadDaysByKeys(keys)`와 최근 7일 sheet를 추가한다. 목표 달성·건강 해석 문구는 만들지 않는다.
