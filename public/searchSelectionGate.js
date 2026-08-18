import { normalizeSearchFoodsResponse } from '../src/lib/searchFoodsResponse.js';

export const BROAD_SEARCH_MESSAGE = '검색 결과가 많습니다. 브랜드와 메뉴명을 함께 입력해 주세요.';

/**
 * Production boundary for the single submit path. Candidate work is deliberately
 * downstream of the `hasMore` check so a broad search cannot select or save an
 * arbitrary first result.
 */
export async function runSingleSearchConsumer({ response, status, continueWithCandidates }) {
  const { items, hasMore } = normalizeSearchFoodsResponse(response);
  if (hasMore) {
    status.className = 'search-status';
    status.hidden = false;
    status.textContent = BROAD_SEARCH_MESSAGE;
    return { blocked: true, items: [], hasMore: true };
  }

  await continueWithCandidates({ items, hasMore });
  return { blocked: false, items, hasMore: false };
}

/**
 * Production multi-search resolution loop. `resolveCandidates` owns matching
 * and nutrient preparation, but is never called for a broad response.
 */
export async function resolveMultiSearches({
  pieces, searchFoods, isUsable, resolveCandidates, onSearchError = () => {},
}) {
  const results = [];

  for (const piece of pieces) {
    if (!isUsable(piece)) {
      results.push({ text: piece.text, ok: false });
      continue;
    }

    try {
      const { items, hasMore } = normalizeSearchFoodsResponse(await searchFoods(piece.parsed.query));
      if (hasMore) {
        results.push({ text: piece.text, ok: false, message: BROAD_SEARCH_MESSAGE });
        continue;
      }
      results.push(await resolveCandidates(piece, items));
    } catch (error) {
      onSearchError(piece, error);
      results.push({ text: piece.text, ok: false });
    }
  }

  return results;
}

/**
 * Production multi-add loop. Broad unresolved rows stay in `leftover` and do
 * not reach storage, exactly like other incomplete rows.
 */
export async function addMultiSearches({ resolved, addEntry }) {
  const failed = [];
  const broad = [];
  const incomplete = [];
  let added = 0;

  for (const result of resolved) {
    if (!result.ok) {
      if (result.message === BROAD_SEARCH_MESSAGE) broad.push(result.text);
      else failed.push(result.text);
      continue;
    }
    if (await addEntry(result)) added += 1;
    else incomplete.push(result.text);
  }

  return {
    added,
    failed,
    broad,
    incomplete,
    leftover: [...failed, ...broad, ...incomplete],
  };
}

/** Keep the refinement sentence intact: it already carries its own period. */
export function multiSearchStatus({ added, failed, broad, incomplete }) {
  const reasons = [];
  if (failed.length > 0) reasons.push(`${failed.length}개는 못 알아들었습니다.`);
  if (broad.length > 0) reasons.push(BROAD_SEARCH_MESSAGE);
  if (incomplete.length > 0) reasons.push(`${incomplete.length}개는 DB에 탄단지가 없어 직접 입력해야 합니다.`);
  const detail = reasons.join(' ');
  return added > 0 ? `${added}개 추가. ${detail}` : detail;
}
