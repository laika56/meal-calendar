import { normalizeSearchFoodsResponse } from '../src/lib/searchFoodsResponse.js';

export const BROAD_SEARCH_MESSAGE = '검색 결과가 많습니다. 브랜드와 메뉴명을 함께 입력해 주세요.';

/**
 * The only boundary allowed to pass search candidates to selection code.
 * A broad response must be refined; choosing its first item would be arbitrary.
 */
export function consumeSearchCandidates(response, { onCandidates, onBroad } = {}) {
  const { items, hasMore } = normalizeSearchFoodsResponse(response);
  if (hasMore) {
    onBroad?.(BROAD_SEARCH_MESSAGE);
    return { blocked: true, items: [], hasMore: true };
  }
  onCandidates?.(items);
  return { blocked: false, items, hasMore: false };
}
