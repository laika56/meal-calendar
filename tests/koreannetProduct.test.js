import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { koreannetProductName, parseKoreannetProduct } from '../src/lib/koreannetProduct.js';

const realPage = await readFile(
  new URL('./fixtures/koreannet-8809396600014.html', import.meta.url),
  'utf8',
);

// 빈 페이지도 HTTP 200 이다. 실측(2026-08-27): 없는 바코드 → 200, 6,143 bytes, 빈 제목.
const emptyPage = '<div class="pv_title">\n<h3></h3>\n<table class="pv_info"><tbody></tbody></table>\n</div>';

test('reads the product identity the barcode actually belongs to', () => {
  // 사용자가 실제로 스캔한 제품이다. OFF 는 이걸 「계란 / 구르농닭」이라고 했다.
  assert.deepEqual(parseKoreannetProduct(realPage, '8809396600014'), {
    barcode: '8809396600014',
    name: '감동란',
    brand: '(주)마루카네코리아',
    provider: 'koreannet',
    fullTitle: '(주)마루카네코리아 감동란 감동란 50G x 2EA',
  });
});

test('returns null for the empty page an unknown barcode still answers 200 with', () => {
  assert.equal(parseKoreannetProduct(emptyPage, '8809999999994'), null);
});

test('returns null instead of guessing when the page has no title block at all', () => {
  assert.equal(parseKoreannetProduct('<html><body>점검 중입니다</body></html>', '8809396600014'), null);
  assert.equal(parseKoreannetProduct('', '8809396600014'), null);
});

test('rejects a missing html or barcode without inventing a product', () => {
  assert.equal(parseKoreannetProduct(realPage, ''), null);
  assert.equal(parseKoreannetProduct(realPage, '   '), null);
  assert.equal(parseKoreannetProduct(null, '8809396600014'), null);
  assert.equal(parseKoreannetProduct(realPage, null), null);
});

// ── 검색어 만들기 ───────────────────────────────────────────────────────────
// 아래 입력은 전부 2026-08-27 실측 페이지의 제목 그대로다. 지어낸 문자열이 아니다.

test('keeps the product name when the seller is named after the product', () => {
  // 판매자 「(주)감동란」을 그대로 지우면 제품명이 사라진다. 그때는 되돌려야 한다.
  // 지우고 끝냈더니 빈 질의가 됐고, 빈 질의로 식약처를 치면 319,060건이 통째로 왔다.
  assert.equal(
    koreannetProductName('(주)마루카네코리아 감동란 감동란 50G x 2EA', '(주)마루카네코리아', '(주)감동란'),
    '감동란',
  );
});

test('never returns an empty query for a page that has a title', () => {
  for (const [title, maker, seller] of [
    ['(주)감동란 감동란', '(주)감동란', '(주)감동란'],
    ['서울우유협동조합', '서울우유협동조합', null],
    ['500G x 1EA', null, null],
  ]) {
    const query = koreannetProductName(title, maker, seller);
    assert.ok(query !== null && query.trim() !== '', `빈 질의가 나왔다: ${title}`);
  }
});

test('strips the maker, the pack size, and the repeated tokens around a real name', () => {
  const cases = [
    [['(주)농심 짜파게티큰사발 123G x 1EA', '(주)농심', null], '짜파게티큰사발'],
    [['하이트진로(주) 참이슬 후레쉬 360mL x 1ea', '하이트진로(주)', null], '참이슬 후레쉬'],
    [['제주특별자치도개발공사 삼다수 제주삼다수 500G x 1EA', '제주특별자치도개발공사', null], '삼다수 제주삼다수'],
    [['동아오츠카(주) 포카리스웨트 포카리스웨트620ML 620G x 1EA', '동아오츠카(주)', null], '포카리스웨트'],
    [['(주)오리온 촉촉한초코칩 320G', '(주)오리온', null], '촉촉한초코칩'],
    [['베이컨까르보나라파스타230g', null, null], '베이컨까르보나라파스타'],
  ];
  for (const [args, expected] of cases) {
    assert.equal(koreannetProductName(...args), expected, `입력: ${args[0]}`);
  }
});

test('decodes the html entities the page ships inside product names', () => {
  assert.equal(
    koreannetProductName('농심켈로그(주) 카라멜 &amp; 피칸 프로틴 딜라이트 350g', '농심켈로그(주)', null),
    '카라멜 & 피칸 프로틴 딜라이트',
  );
});

test('rejects a non-string title rather than coercing it', () => {
  for (const value of [null, undefined, 42, {}]) {
    assert.equal(koreannetProductName(value), null);
  }
});
