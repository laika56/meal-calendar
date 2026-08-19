# 통합 바코드 조회 구현 계획

**목표:** 국내 공용 카탈로그 → OFF → UPCitemdb 식별 후보 순서를 지키고 UPCitemdb 값은 영양으로 승격하지 않는다.

**파일:** `functions/shared/upcItemDb.js`, `functions/index.js`, `public/db.js`, `public/barcodeLookupFlow.js`, `public/app.js`, `tests/upcItemDb.test.js`, `tests/barcodeLookupFunction.test.js`, `tests/barcodeLookupFlow.test.js`, `tests/barcodeAppIntegration.test.js`.

## Task 1 — UPCitemdb adapter

- [ ] RED: canonical GTIN exact hit/miss, 복수 identity 충돌, malformed, 429, 8초 abort를 작성한다.
- [ ] GREEN: `lookupUpcItemIdentity(code,{fetchImpl,timeoutMs:8000})`를 구현한다. 허용 필드는 `barcode,name,brand,category,imageUrl,provider`뿐이다.

```js
assert.deepEqual(result, {
  barcode: '8801234567890', name: '제품명', brand: '브랜드',
  category: '분류', imageUrl: null, provider: 'upcitemdb',
});
assert.equal('kcal' in result, false);
```

## Task 2 — 인증된 Function 응답

- [ ] RED: 인증 전에 외부 호출 0, 기본 요청은 기존 `{item}` 호환, `includeIdentity=1`에서만 UPC 조회, provider 상태 분류를 검증한다.
- [ ] GREEN: 기존 `/api/foods/barcode`에 선택적 identity 모드를 추가한다. shared hit면 UPC를 호출하지 않고, miss일 때만 exact identity를 반환한다.

## Task 3 — 클라이언트 순서와 검색 인계

- [ ] RED: shared hit, shared miss→OFF hit, 둘 다 miss→UPC identity, identity가 영양/자동저장으로 가지 않는 소비자 테스트를 쓴다.
- [ ] GREEN: `public/db.js`가 전체 envelope를 보존하고 flow가 세 번째 단계에서만 identity 요청한다. identity는 검색어를 채우고 기존 식약처 검색을 실행한다.
- [ ] UPC 장애는 수동 입력/OCR 경로를 유지하며 기존 두 provider 성공을 덮지 않는다.
