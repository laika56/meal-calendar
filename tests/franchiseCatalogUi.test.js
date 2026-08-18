import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSearchFoodsResponse } from '../src/lib/searchFoodsResponse.js';
import { createSearchResult } from '../public/searchResult.js';
import {
  buildPartialNutritionProvenance, formNumber, showPartialNutritionEntry,
} from '../public/partialNutritionEntry.js';
import { searchResultStatus } from '../public/searchStatus.js';

class TestNode extends EventTarget {
  constructor(document, tagName) {
    super();
    this.document = document;
    this.tagName = tagName;
    this.children = [];
    this.hidden = false;
    this.value = '';
    this.textContent = '';
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  focus() {
    this.document.activeElement = this;
  }
}

class TestDocument {
  constructor() {
    this.activeElement = null;
  }

  createElement(tagName) {
    return new TestNode(this, tagName);
  }
}

function partialForm(document) {
  const names = ['name', 'amountG', 'kcal', 'carbG', 'proteinG', 'fatG'];
  const elements = Object.fromEntries(names.map((name) => [name, new TestNode(document, 'input')]));
  return {
    elements,
    reset() {
      for (const element of Object.values(elements)) element.value = '';
    },
  };
}

const bmt = {
  name: '이탈리안 비엠티',
  maker: '써브웨이',
  per100g: { kcal: 170, carbG: null, proteinG: 9, fatG: null },
  serving: { amount: 228, unit: 'g', source: 'official-serving' },
  servingNutrients: { kcal: 388, carbG: null, proteinG: 21, fatG: null },
  source: {
    type: 'official_brand',
    label: '공식값',
    url: 'https://www.subway.co.kr/menuView/sandwich?menuItemIdx=1528',
    verifiedAt: '2026-08-18T00:00:00.000Z',
  },
};

test('normalizes the API payload without discarding hasMore and accepts legacy arrays only at the boundary', () => {
  assert.deepEqual(
    normalizeSearchFoodsResponse({ items: [bmt], hasMore: true }),
    { items: [bmt], hasMore: true },
  );
  assert.deepEqual(normalizeSearchFoodsResponse([bmt]), { items: [bmt], hasMore: false });
  assert.throws(() => normalizeSearchFoodsResponse({ items: null, hasMore: true }), /items must be an array/);
});

test('BMT result renders serving kcal, source link, and no invented zero nutrients', () => {
  const document = new TestDocument();
  const result = createSearchResult(document, bmt, { onSelect() {} });
  const [button, sourceLink] = result.children;
  const [, meta] = button.children;

  assert.equal(meta.textContent, '써브웨이 · 공식값 · 1인분 228g · 388kcal');
  assert.doesNotMatch(meta.textContent, /100g당|탄수화물 0|지방 0/);
  assert.equal(sourceLink.tagName, 'a');
  assert.equal(sourceLink.target, '_blank');
  assert.equal(sourceLink.rel, 'noopener noreferrer');

  const unsafe = createSearchResult(document, { ...bmt, source: { ...bmt.source, url: 'javascript:alert(1)' } });
  assert.equal(unsafe.children.length, 1);
});

test('confirm event reveals partial manual entry, names fields, and moves focus off the hidden confirm button', () => {
  const document = new TestDocument();
  const form = partialForm(document);
  const notice = new TestNode(document, 'p');
  const confirm = new TestNode(document, 'button');
  const portion = new TestNode(document, 'section');
  const chooser = new TestNode(document, 'section');
  chooser.hidden = true;

  confirm.addEventListener('click', () => showPartialNutritionEntry({
    form,
    notice,
    food: bmt,
    amountG: 228,
    scaled: { kcal: 388, carbG: null, proteinG: 21, fatG: null },
    showManualForm() {
      portion.hidden = true;
      chooser.hidden = false;
    },
  }));

  confirm.focus();
  confirm.dispatchEvent(new Event('click'));

  assert.equal(portion.hidden, true);
  assert.equal(chooser.hidden, false);
  assert.equal(notice.textContent, '공식 자료에 없는 탄수화물·지방은 직접 입력해야 합니다.');
  assert.equal(document.activeElement, form.elements.carbG);
  assert.equal(form.elements.kcal.value, 388);
  assert.equal(form.elements.proteinG.value, 21);
  assert.equal(form.elements.carbG.value, '');
  assert.equal(form.elements.fatG.value, '');
});

test('a server hasMore response controls the single-search refinement copy', () => {
  assert.equal(
    searchResultStatus({ hasMore: true, parsed: { ok: true, reason: null } }),
    '검색 결과가 많습니다. 브랜드와 메뉴명을 함께 입력해 주세요.',
  );
  assert.equal(
    searchResultStatus({ hasMore: false, parsed: { ok: true, reason: null } }),
    '정확히 일치하는 이름이 없습니다. 아래에서 골라주세요.',
  );
});

test('blank manual values stay invalid and completed partial fields retain per-field provenance', () => {
  assert.ok(Number.isNaN(formNumber(new Map([['carbG', '']]), 'carbG')));
  assert.deepEqual(
    buildPartialNutritionProvenance({
      numericFields: { kcal: 388, proteinG: 21 },
      source: bmt.source,
      fields: { kcal: 388, carbG: 42, proteinG: 21, fatG: 12 },
    }),
    {
      kcal: 'official_brand',
      carbG: 'manual',
      proteinG: 'official_brand',
      fatG: 'manual',
      sourceUrl: bmt.source.url,
      verifiedAt: bmt.source.verifiedAt,
    },
  );
});
