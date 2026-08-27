import { parseKoreannetProduct, shouldAskKoreannet } from './shared/koreannetProduct.js';

/**
 * 코리안넷 상품 페이지에서 바코드의 **제품명**을 가져온다.
 *
 * **서버에서만 부른다.** 페이지가 `http` 라 HTTPS PWA 에서 직접 부르면 혼합 콘텐츠로
 * 막히고, CORS 도 열려 있지 않다.
 *
 * **스캔 한 건당 한 번만 부른다.** 목록을 훑거나 미리 받아두지 않는다 —
 * 페이지에 「무단 수집 및 유통, 거래」를 금지한다고 적혀 있다. 공용 카탈로그(`foods/`)에
 * 적재하지 않는 것도 같은 이유다.
 *
 * 실측(2026-08-27, N=300): 이름 있음 93.7% · 에러 0 · p50 233ms / p90 313ms.
 * 없는 바코드도 HTTP 200 에 빈 페이지를 준다 — 판정은 파서가 제목으로 한다.
 */
const KOREANNET_URL = 'http://gs1.koreannet.or.kr/pr';
const TIMEOUT_MS = 4000;

export async function lookupKoreannetIdentity(code, { fetchImpl = fetch } = {}) {
  // 잰 범위(880·881 13자리) 밖은 묻지 않는다. 미국 바코드에 엉뚱한 값을 돌려주고
  // 그게 UPCitemdb 를 가로챈다 — 2026-08-27 배포본에서 실제로 잡혔다.
  if (!shouldAskKoreannet(code)) return null;
  const barcode = code.trim();

  let response;
  try {
    response = await fetchImpl(`${KOREANNET_URL}/${encodeURIComponent(barcode)}`, {
      headers: { 'User-Agent': 'meal-calendar/1.0 (personal diet log; +mailto:fanyea96@gmail.com)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // 조회 실패는 「제품 없음」이 아니다. 다음 출처로 넘어가게 null 을 준다.
    return null;
  }
  if (!response.ok) return null;

  let html;
  try {
    html = await response.text();
  } catch {
    return null;
  }
  return parseKoreannetProduct(html, barcode);
}
