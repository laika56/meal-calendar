import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSearchFoodsResponse } from '../src/lib/searchFoodsResponse.js';
import { createSearchResult } from '../public/searchResult.js';
import {
  buildPartialNutritionProvenance, formNumber, showPartialNutritionEntry,
} from '../public/partialNutritionEntry.js';
import { searchResultStatus } from '../public/searchStatus.js';
import {
  BROAD_SEARCH_MESSAGE, addMultiSearches, multiSearchStatus, resolveMultiSearches,
  restoreMultiSearchLeftovers, runSingleSearchConsumer,
} from '../public/searchSelectionGate.js';

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

test('the production single-submit consumer blocks broad results before selection, manual entry, or storage', async () => {
  const status = new TestNode(new TestDocument(), 'p');
  const calls = [];
  const broad = await runSingleSearchConsumer({
    response: { items: [bmt], hasMore: true },
    status,
    continueWithCandidates: async () => calls.push('candidate-selection', 'manual-prefill', 'save'),
  });

  assert.deepEqual(broad, { blocked: true, items: [], hasMore: true });
  assert.equal(status.textContent, BROAD_SEARCH_MESSAGE);
  assert.deepEqual(calls, []);

  const finite = await runSingleSearchConsumer({
    response: { items: [bmt], hasMore: false },
    status,
    continueWithCandidates: async ({ items, hasMore }) => {
      calls.push(`candidate-selection:${items[0].name}`, `hasMore:${hasMore}`, 'save');
    },
  });
  assert.deepEqual(finite, { blocked: false, items: [bmt], hasMore: false });
  assert.deepEqual(calls, ['candidate-selection:이탈리안 비엠티', 'hasMore:false', 'save']);

  const legacy = await runSingleSearchConsumer({
    response: [bmt],
    status,
    continueWithCandidates: async () => calls.push('legacy-selection'),
  });
  assert.deepEqual(legacy, { blocked: false, items: [bmt], hasMore: false });
  assert.deepEqual(calls, ['candidate-selection:이탈리안 비엠티', 'hasMore:false', 'save', 'legacy-selection']);
});

test('the production multi resolver and add consumer retain broad pieces and restore exact refinement status', async () => {
  const selected = [];
  const broadResults = await resolveMultiSearches({
    pieces: [{ text: '서브웨이 100g', parsed: { ok: true, query: '서브웨이' } }],
    searchFoods: async () => ({ items: [bmt], hasMore: true }),
    isUsable: () => true,
    resolveCandidates: async () => {
      selected.push('candidate-selection', 'portion-confirmation', 'manual-prefill');
      return { ok: true, text: 'should not happen' };
    },
  });
  assert.deepEqual(broadResults, [{ text: '서브웨이 100g', ok: false, message: BROAD_SEARCH_MESSAGE }]);
  assert.deepEqual(selected, []);

  const stored = [];
  const blockedSummary = await addMultiSearches({
    resolved: broadResults,
    addEntry: async (result) => stored.push(result),
  });
  assert.deepEqual(stored, []);
  assert.deepEqual(blockedSummary.leftover, ['서브웨이 100g']);
  assert.equal(multiSearchStatus(blockedSummary), BROAD_SEARCH_MESSAGE);

  const normalResults = await resolveMultiSearches({
    pieces: [{ text: '이탈리안 비엠티 100g', parsed: { ok: true, query: '이탈리안 비엠티' } }],
    searchFoods: async () => [bmt],
    isUsable: () => true,
    resolveCandidates: async (piece, items) => ({ ok: true, text: piece.text, food: items[0], amountG: 100 }),
  });
  const normalSummary = await addMultiSearches({
    resolved: normalResults,
    addEntry: async (result) => {
      stored.push(result.food.name);
      return true;
    },
  });
  assert.deepEqual(stored, ['이탈리안 비엠티']);
  assert.equal(normalSummary.added, 1);
  assert.deepEqual(normalSummary.leftover, []);

  const hasMoreFalseResults = await resolveMultiSearches({
    pieces: [{ text: '이탈리안 비엠티 100g', parsed: { ok: true, query: '이탈리안 비엠티' } }],
    searchFoods: async () => ({ items: [bmt], hasMore: false }),
    isUsable: () => true,
    resolveCandidates: async (piece) => ({ ok: true, text: piece.text }),
  });
  assert.deepEqual(hasMoreFalseResults, [{ ok: true, text: '이탈리안 비엠티 100g' }]);
});

test('mixed production multi consumers add only the finite row and restore the exact broad input', async () => {
  const normalInput = '이탈리안 비엠티 100g';
  const broadInput = '서브웨이 100g';
  const downstream = [];
  const resolved = await resolveMultiSearches({
    pieces: [
      { text: normalInput, parsed: { ok: true, query: '이탈리안 비엠티' } },
      { text: broadInput, parsed: { ok: true, query: '서브웨이' } },
    ],
    searchFoods: async (query) => (query === '서브웨이'
      ? { items: [bmt], hasMore: true }
      : { items: [bmt], hasMore: false }),
    isUsable: () => true,
    resolveCandidates: async (piece, items) => {
      if (piece.text === broadInput) {
        downstream.push('broad-selection', 'broad-manual-prefill', 'broad-save');
      }
      downstream.push(`select:${piece.text}`);
      return {
        ok: true,
        text: piece.text,
        food: items[0],
        amountG: 100,
        quickInput: piece.parsed,
      };
    },
  });

  assert.deepEqual(downstream, [`select:${normalInput}`]);
  assert.deepEqual(resolved[1], {
    text: broadInput,
    ok: false,
    message: BROAD_SEARCH_MESSAGE,
  });

  const stored = [];
  const summary = await addMultiSearches({
    resolved,
    addEntry: async (result) => {
      stored.push(result);
      return true;
    },
  });

  assert.equal(summary.added, 1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0], resolved[0]);
  assert.equal(stored[0].food, bmt);
  assert.deepEqual(summary.leftover, [broadInput]);

  const document = new TestDocument();
  const input = new TestNode(document, 'input');
  const status = new TestNode(document, 'p');
  restoreMultiSearchLeftovers({ summary, input, status });

  assert.equal(input.value, broadInput);
  assert.equal(status.hidden, false);
  assert.equal(
    status.textContent,
    '1개 추가. 검색 결과가 많습니다. 브랜드와 메뉴명을 함께 입력해 주세요.',
  );
});
