# 영양성분표 OCR 구현 계획

**목표:** 사진을 기기 안에서만 OCR하고, 사용자가 확인한 이름·양·열량 및 선택 영양값으로 entry를 만든다.

**파일:** `src/lib/nutritionLabel.js`, `public/nutritionLabelOcr.js`, `tests/nutritionLabel.test.js`, `tests/nutritionLabelOcr.test.js`, `public/app.js`, `public/index.html`, `public/sw.js`, `tests/uiShell.test.js`, `tests/shellFiles.test.js`.

## Task 1 — 엄격 파서

- [ ] RED: 총 내용량/1회 제공량, 열량, 탄·단·지, 단위 누락, 경쟁 숫자, 빈 값 테스트를 작성하고 모듈 부재 실패를 확인한다.
- [ ] GREEN: `parseNutritionLabel(text)`가 닫힌 `{ amount, amountUnit, kcal, carbG, proteinG, fatG }`를 반환하게 한다. 표제 옆 단일 값만 인정하고 모호하면 `null`이다.
- [ ] `node --test tests/nutritionLabel.test.js`

```js
assert.deepEqual(parseNutritionLabel('총 내용량 100 g\n열량 220 kcal\n단백질 8 g'), {
  amount: 100, amountUnit: 'g', kcal: 220,
  carbG: null, proteinG: 8, fatG: null,
});
```

## Task 2 — 지연 OCR 경계

- [ ] RED: OCR 모듈을 열기 전 worker 0개, 열면 한 번만 생성, 완료·실패·취소 모두 terminate를 검증한다.
- [ ] GREEN: 고정 Tesseract.js `7.0.0`을 동적 import하고 `kor+eng` worker를 호출하는 `recognizeNutritionLabel(file,{loadTesseract})`를 구현한다. 테스트는 loader를 주입한다.
- [ ] 사진·OCR 원문이 반환 entry나 네트워크 payload에 포함되지 않는 테스트를 추가한다.

## Task 3 — 확인 UI

- [ ] RED: 촬영 버튼, 파일 input, 확인 필드, 수동 전환, 취소 시 저장 0, 확인 시 `addedBy:'label-scan'`/`source:'nutrition-label'` 테스트를 작성한다.
- [ ] GREEN: 바코드/검색 실패 화면에서만 진입점을 보이고, 이름·양·열량이 채워져야 저장한다. 탄·단·지는 빈 값을 `null`로 보존한다.
- [ ] shell 목록과 digest는 모든 UI 변경이 끝난 통합 단계에서 갱신한다.
