# 데이터 내보내기·복구 구현 계획

**목표:** 본인 데이터를 브라우저에서 JSON/CSV로 내보내고, 검증된 JSON을 기존 문서 비덮어쓰기 방식으로 복구한다.

**파일:** `src/lib/dataTransfer.js`, `tests/dataTransfer.test.js`, `public/db.js`, `public/app.js`, `public/index.html`, `tests/dataTransferIntegration.test.js`, `tests/firestore.rules.test.js`.

## Task 1 — canonical envelope와 CSV

- [ ] RED: 닫힌 root, canonical 정렬, CSV escaping, nullable nutrients, 사진/OCR 원문 제외를 테스트한다.
- [ ] GREEN: `buildExportEnvelope(data,{exportedAt})`, `serializeExportJson`, `serializeDaysCsv`를 구현한다.

## Task 2 — 전체 선검증과 merge plan

- [ ] RED: unknown field, 잘못된 날짜/숫자, 중복 preset, version 불일치, 기존 day/preset 충돌에서 writes 0을 검증한다.
- [ ] GREEN: `validateExportEnvelope(value)`와 `planMergeRestore(current,incoming)`를 구현한다.

```js
assert.deepEqual(plan, {
  daysToWrite: ['2026-08-18'], presetsToWrite: ['preset-b'],
  dayConflicts: ['2026-08-19'], presetConflicts: ['preset-a'],
});
```

## Task 3 — 설정 UI와 Firestore 실행

- [ ] RED: 확인 전 쓰기 0, 충돌 skip, 모든 Promise 완료 후 결과 표시, 일부 실패를 성공으로 표시하지 않는 테스트를 쓴다.
- [ ] GREEN: 다운로드 Blob은 즉시 revoke하고 import 원문은 저장하지 않는다. db는 본인 uid 하위만 읽고 batch 단위로 새 문서만 쓴다.
