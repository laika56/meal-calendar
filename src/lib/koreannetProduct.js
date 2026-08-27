/**
 * 코리안넷(대한상공회의소 유통물류진흥원) 상품 페이지에서 **제품명만** 뽑는다.
 *
 * 왜 필요한가 (2026-08-27): 국내 바코드의 이름을 아는 곳이 여기뿐이다.
 * `8809396600014` 는 Open Food Facts 에 「계란 / 구르농닭」으로 잘못 올라와 있고,
 * 식약처 API 는 **바코드로 조회하는 경로가 없다**(이름으로만 찾는다).
 * 그래서 바코드 → 이름을 코리안넷이 잇고, 그 이름으로 식약처를 검색한다.
 *
 * **영양값은 여기서 오지 않는다.** 페이지에 열량·탄단지·중량이 아예 없다(실측 확인).
 * 이 모듈이 만드는 건 **검색어**이고, 어느 식약처 항목을 고를지는 사용자가 정한다.
 * 자동 선택하지 않는다 — 절대규칙 2.
 *
 * ## 실측 (2026-08-27)
 *
 * **커버리지** — OFF 한국 제품에서 뽑은 실제 880 바코드 **N=300**:
 * 이름 있음 281(93.7%) · 빈 페이지 19(6.3%) · 에러 0 · 응답 p50 233ms / p90 313ms.
 * 지금 앱이 이름을 못 주는 36건 중 **31건(86.1%)** 을 여기가 메운다.
 *
 * **그 이름으로 식약처를 쳤을 때** — N=86:
 * 이름이 실제로 겹치는 결과 **31(36.0%)** · 겹치지 않는 결과 **0** · 질의 실패 0 ·
 * 0건이거나 너무 넓음 55(64.0%).
 *
 * 나머지 64% 는 **식약처에 그 제품이 없는 것**이지 이 모듈의 실패가 아니다.
 * 그때도 사용자는 「감동란 50G x 2EA」라는 정확한 이름을 보고 영양성분표를 찍으면 된다 —
 * 아무것도 못 보던 지금보다 낫다.
 *
 * ## 넓은 후보 질의를 만들지 않는다
 *
 * 초안은 제품명이 안 걸리면 「마지막 두 토큰」·「제일 긴 토큰」으로 물러났다.
 * 그러면 적중률이 34.1% → 77.6% 로 뛰는데, **올라간 43%p 가 전부 오답이었다**:
 * `삼다수` → 「라면꼰대x제주삼다수 고사롱라면 426kcal」, `참이슬 후레쉬` → 「통밀후레쉬
 * 샌드위치」. 물에 라면 열량을 붙이는 것은 아무것도 안 주는 것보다 나쁘다.
 * **좁은 질의 하나만 만든다.**
 */

const CORP_FORMS = /\(\s*주\s*\)|주식회사|㈜|\(유\)|농업회사법인|유한회사|협동조합/g;
const PACK_COUNT = /\s*x\s*\d+\s*(?:ea|개|입)?\s*/gi;
const PACK_SIZE = /\s*\d+(?:\.\d+)?\s*(?:g|kg|mg|ml|㎖|l|매|p|ea|개|입|정|포|팩|병|캔|봉)\b/gi;

const ENTITIES = Object.freeze({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
});

function decodeEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);
}

function squeeze(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function stripTags(value) {
  return squeeze(decodeEntities(value.replace(/<[^>]*>/g, ' ')));
}

/** 같은 낱말이 되풀이되는 표기를 한 번으로. 「감동란 감동란 50G」→「감동란」 */
function dedupeWords(value) {
  const words = squeeze(value).split(' ').filter(Boolean);
  return words.filter((word, index) => words.indexOf(word) === index).join(' ');
}

function trimPackaging(value) {
  return dedupeWords(value.replace(CORP_FORMS, ' ').replace(PACK_COUNT, ' ').replace(PACK_SIZE, ' '));
}

/**
 * 페이지 제목에서 조직명과 포장 표기를 걷어내 **검색어 하나**를 만든다.
 *
 * 조직명을 지우다 아무것도 안 남으면 **되돌린다.** 회사 이름이 제품 이름과 같은 경우가
 * 있다 — `8809396600014` 의 판매자가 「(주)감동란」이고 제품이 「감동란」이다.
 * 그대로 지웠더니 질의가 빈 문자열이 됐고, **빈 질의로 식약처를 치면 319,060건이
 * 통째로 돌아왔다**(2026-08-27 실측). 빈 질의는 검색이 아니라 전체 덤프다.
 */
export function koreannetProductName(title, maker = null, seller = null) {
  if (typeof title !== 'string') return null;
  const base = squeeze(decodeEntities(title));
  if (!base) return null;

  let kept = base;
  for (const org of [maker, seller]) {
    if (typeof org !== 'string' || !org.trim()) continue;
    let candidate = kept;
    const bare = squeeze(decodeEntities(org).replace(CORP_FORMS, ' '));
    for (const form of [squeeze(decodeEntities(org)), bare]) {
      // 한 글자짜리는 지우지 않는다 — 제품명 속 글자를 갉아먹는다.
      if (form.length >= 2 && candidate.includes(form)) candidate = candidate.split(form).join(' ');
    }
    if (trimPackaging(candidate)) kept = candidate;
  }

  // 포장 표기까지 떼서 비면 남겨둔 쪽으로, 그래도 비면 원문으로 후퇴한다.
  return trimPackaging(kept) || dedupeWords(kept.replace(CORP_FORMS, ' ')) || base;
}

function tableField(html, label) {
  const pattern = new RegExp(`<th>\\s*${label}[\\s\\S]{0,80}?</th>\\s*<td>([\\s\\S]*?)</td>`);
  const match = html.match(pattern);
  if (match === null) return null;
  const value = stripTags(match[1]);
  return value === '' ? null : value;
}

/**
 * 상품 페이지 HTML → 식별 정보. **영양값은 이 페이지에 없다.**
 *
 * 없는 바코드도 HTTP 200 을 준다 — 제목이 빈 껍데기 페이지다(실측: 6,143 bytes).
 * 그래서 상태코드가 아니라 **제목이 있느냐**로 판정한다.
 */
export function parseKoreannetProduct(html, barcode) {
  if (typeof html !== 'string' || typeof barcode !== 'string' || !barcode.trim()) return null;

  const titleMatch = html.match(/<div class="pv_title">\s*<h3>([\s\S]*?)<\/h3>/);
  if (titleMatch === null) return null;
  const title = stripTags(titleMatch[1]);
  if (title === '') return null;

  const maker = tableField(html, '제조사/생산자');
  const seller = tableField(html, '판매자');
  const name = koreannetProductName(title, maker, seller);
  if (name === null || name === '') return null;

  return {
    barcode: barcode.trim(),
    name,
    brand: maker ?? seller ?? null,
    provider: 'koreannet',
    // 사용자가 「이게 정말 그 제품인가」를 직접 볼 수 있어야 한다.
    fullTitle: title,
  };
}
