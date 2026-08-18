/** Return the single status message shown after a non-empty search response. */
export function searchResultStatus({ hasMore, parsed }) {
  if (hasMore) return '검색 결과가 많습니다. 브랜드와 메뉴명을 함께 입력해 주세요.';
  if (parsed.ok) return '정확히 일치하는 이름이 없습니다. 아래에서 골라주세요.';
  if (parsed.reason === 'unsupported-serving') {
    return '이 단위는 아직 자동 환산하지 못합니다. 음식을 고른 뒤 g을 입력해주세요.';
  }
  return null;
}
