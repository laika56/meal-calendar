import { isValidBarcode, toEan13, upcEToUpcA } from './barcode.js';

const RETAIL_FORMATS = new Set(['EAN13', 'EAN8', 'UPCA', 'UPCE']);
const CORE_NUTRIENTS = ['kcal', 'proteinG', 'fatG', 'carbG'];
const REVIEWED_BARCODE_IDENTITIES = Object.freeze({
  // 제품명·용량만 보존한다. 영양값은 포장/식약처에서 확인되기 전까지 채우지 않는다.
  // 2026-08-24 확인: 롯데마트 제타 상품 고시의 상품판매코드와 제품명.
  '8801056249052': Object.freeze({
    barcode: '8801056249052',
    name: '오트몬드 프로틴 고소한맛 250ML',
    brand: '롯데',
    provider: 'reviewed-retailer',
    sourceUrl: 'https://lottemartzetta.com/products/OS8801056249052/details',
  }),
});

export function barcodeCapturePlan(videoWidth, videoHeight) {
  if (!Number.isFinite(videoWidth) || videoWidth <= 0
    || !Number.isFinite(videoHeight) || videoHeight <= 0) return null;

  const sourceWidth = Math.max(1, Math.floor(Math.min(videoWidth * 0.76, videoHeight * 2.5)));
  const sourceHeight = Math.max(1, Math.round(sourceWidth / 2.5));
  const outputWidth = Math.min(sourceWidth, 1280);
  const outputHeight = Math.round(sourceHeight * outputWidth / sourceWidth);
  return {
    sourceX: Math.floor((videoWidth - sourceWidth) / 2),
    sourceY: Math.floor((videoHeight - sourceHeight) / 2),
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
  };
}

/** 조준창 전체가 아니라 EAN/UPC 막대 아래의 숫자 한 줄만 OCR하기 위한 확대 영역. */
export function barcodeDigitCropPlan(width, height) {
  if (!Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0) return null;

  const sourceX = Math.round(width * 0.04);
  const sourceY = Math.min(height - 1, Math.round(height * 0.52));
  const sourceWidth = Math.max(1, width - (sourceX * 2));
  const sourceHeight = Math.max(1, Math.min(
    height - sourceY,
    Math.round(height * 0.44),
  ));
  const scale = Math.min(2, 1600 / sourceWidth);
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth: Math.round(sourceWidth * scale),
    outputHeight: Math.round(sourceHeight * scale),
  };
}

export function barcodeVideoConstraints() {
  return {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
}

export async function configureBarcodeTrack(track) {
  if (typeof track?.getCapabilities !== 'function'
    || typeof track?.applyConstraints !== 'function') return false;

  let capabilities;
  try {
    capabilities = track.getCapabilities();
  } catch {
    return false;
  }

  const preferred = {};
  if (Array.isArray(capabilities?.focusMode)
    && capabilities.focusMode.includes('continuous')) {
    preferred.focusMode = 'continuous';
  }

  const minZoom = capabilities?.zoom?.min;
  const maxZoom = capabilities?.zoom?.max;
  if (Number.isFinite(minZoom) && Number.isFinite(maxZoom) && maxZoom > minZoom) {
    const zoom = Math.max(minZoom, Math.min(2, maxZoom));
    if (zoom > minZoom) preferred.zoom = zoom;
  }

  if (Object.keys(preferred).length === 0) return false;
  const attempts = [preferred];
  if ('focusMode' in preferred && 'zoom' in preferred) {
    attempts.push({ focusMode: preferred.focusMode });
  }
  for (const attempt of attempts) {
    try {
      await track.applyConstraints({ advanced: [attempt] });
      return true;
    } catch {
      // 줌을 거부하는 기기에서도 연속 초점은 한 번 더 독립 시도한다.
    }
  }
  return false;
}

export function extractRetailBarcodeFromOcr(text) {
  if (typeof text !== 'string') throw new TypeError('barcode OCR text must be a string');

  const candidates = new Set();
  for (const line of text.split(/\r?\n/)) {
    const digits = line.replace(/\D/g, '');
    if (digits.length === 8) {
      if (isValidBarcode(digits)) candidates.add(digits);
      continue;
    }
    if (digits.length === 12 || digits.length === 13) {
      const ean13 = toEan13(digits);
      if (ean13 !== null) candidates.add(ean13);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function normalizeRetailBarcode(results) {
  if (!Array.isArray(results)) {
    throw new TypeError('normalizeRetailBarcode: results must be an array');
  }

  for (const result of results) {
    if (!RETAIL_FORMATS.has(result?.format)) continue;
    if (typeof result.text !== 'string') continue;
    let barcode = result.text.trim();
    if (!barcode) continue;
    if (result.format === 'UPCE') {
      barcode = upcEToUpcA(barcode);
      if (barcode === null) continue;
    }
    // EAN-8 은 EAN-13 으로 확장할 수 없다(다른 번호 체계다). 그렇다고 버리면 안 된다 —
    // **Open Food Facts 는 EAN-8 제품을 8자리 코드 그대로 저장한다.** 발주30 은 여기서
    // toEan13 만 통과시켰고, 그 결과 EAN-8 제품이 조회조차 안 되는 회귀가 났다
    // (2026-08-19, 명세를 쓴 쪽 잘못이다). 체크디지트만 확인하고 원문으로 내보낸다.
    if (barcode.length === 8) {
      if (isValidBarcode(barcode)) return barcode;
      continue;
    }
    const ean13 = toEan13(barcode);
    if (ean13 !== null) return ean13;
  }
  return null;
}

export function buildOpenFoodFactsUrl(barcode) {
  if (typeof barcode !== 'string' || !barcode.trim()) {
    throw new TypeError('buildOpenFoodFactsUrl: barcode must be a nonempty string');
  }
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode.trim())}.json`;
}

export function toBarcodeFood(parsed) {
  if (!parsed || typeof parsed.name !== 'string' || !parsed.name.trim()) return null;
  if (parsed.unit !== 'g' && parsed.unit !== 'ml') return null;
  if (!parsed.per100 || !Number.isFinite(parsed.per100.kcal)) return null;
  if (CORE_NUTRIENTS.some((key) => (
    parsed.per100[key] !== null && !Number.isFinite(parsed.per100[key])
  ))) return null;
  if (typeof parsed.code !== 'string' || !parsed.code.trim()) return null;

  const barcode = parsed.code.trim();
  return {
    foodKey: `off_${barcode}`,
    name: parsed.name.trim(),
    maker: typeof parsed.brand === 'string' && parsed.brand.trim() ? parsed.brand.trim() : null,
    source: 'off',
    barcode,
    per100g: { ...parsed.per100 },
    basis: parsed.unit,
    // OFF 가 1회분을 주면 그대로 쓴다. 포장 제품은 중량이 포장에 찍혀 있으므로
    // 사용자에게 그램을 묻지 않는 게 맞다. 파서가 검증에 실패하면 null 이 오고,
    // 그때는 기존대로 「1인분 정보 없음」 경로를 탄다.
    serving: parsed.serving ?? null,
  };
}

/** 사진 없는 OFF 레코드를 믿어주는 최소 채움도. 아래 실측 표에서 나온 값이다. */
const OFF_PHOTOLESS_COMPLETENESS_FLOOR = 0.3;

/**
 * OFF 가 준 제품명을 검색어로 써도 되는지 판정한다.
 *
 * **임계값은 실측 분포에서 나왔다** (2026-08-27). OFF v2 search
 * `countries_tags=south-korea`, `page_size=100`, page 1·2·3·5 — **page 4 는 503 이
 * 4회 연속이라 건너뛰었다.** N=400. 그중 이 판정을 실제로 타는 것(이름 있고 kcal 없음)은
 * 39건(9.8%)이다.
 *
 * | 후보 규칙 | 39건 중 거부 |
 * |---|---|
 * | 사진X 만 | 10 (25.6%) |
 * | completeness<0.30 만 | 18 (46.2%) |
 * | completeness<0.25 만 | 10 (25.6%) |
 * | **사진X AND completeness<0.30** | **4 (10.3%)** |
 *
 * 마지막 규칙이 거부한 4건 전량: `정육` · `다보록` ×2 · `콘드로이친`.
 * **전부 제품명이 아니라 분류·브랜드·성분 이름이고, 검색어로 쓰면 엉뚱한 결과가 나온다.
 * 오탐 0건이다.** 문제의 `8809396600014`(「계란/구르농닭」, 사진X·c=0.2)도 여기 걸린다.
 *
 * 왜 `사진X 만`으로 안 자르나: 사진 없이도 이름이 멀쩡한 것이 10건 중 6건이었다.
 * 왜 `completeness` 단독으로 안 자르나: 46.2% 를 버리는데 그중 대부분은 사진으로
 * 뒷받침되는 이름이다.
 *
 * **신호가 없으면 거부하지 않는다.** `null`·`undefined` 는 「모른다」이지 「나쁘다」가
 * 아니다(절대규칙 7). 모른다고 버리면 quality 를 안 넘기는 호출부가 전부 조용히 죽는다.
 */
export function isTrustedOffIdentity(quality) {
  if (!quality || typeof quality !== 'object') return true;
  if (quality.hasPhoto === true) return true;
  const { completeness } = quality;
  if (typeof completeness !== 'number' || !Number.isFinite(completeness)) return true;
  return completeness >= OFF_PHOTOLESS_COMPLETENESS_FLOOR;
}

export function toBarcodeIdentity(parsed, quality) {
  if (!parsed || typeof parsed.code !== 'string' || !parsed.code.trim()) return null;
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) return null;
  if (!isTrustedOffIdentity(quality)) return null;
  return {
    barcode: parsed.code.trim(),
    name: parsed.name.trim(),
    brand: typeof parsed.brand === 'string' && parsed.brand.trim() ? parsed.brand.trim() : null,
    provider: 'off',
  };
}

export function reviewedBarcodeIdentity(barcode) {
  if (typeof barcode !== 'string') return null;
  return REVIEWED_BARCODE_IDENTITIES[barcode.trim()] ?? null;
}

export function sharedCatalogRecordToFood(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (typeof record.barcode !== 'string' || !record.barcode) return null;
  if (typeof record.name !== 'string' || !record.name.trim()) return null;
  if (!record.per100g || !Number.isFinite(record.per100g.kcal)) return null;
  if (!record.source || typeof record.source.type !== 'string') return null;
  if (CORE_NUTRIENTS.some((key) => (
    record.per100g[key] !== null && !Number.isFinite(record.per100g[key])
  ))) return null;
  const basis = record.serving?.unit === 'mL' ? 'mL' : 'g';
  const nutritionProvenance = Object.fromEntries(CORE_NUTRIENTS.map((key) => [
    key,
    record.per100g[key] === null ? null : record.source.type,
  ]));
  return {
    foodKey: `barcode_${record.barcode}`,
    name: record.name.trim(),
    maker: typeof record.maker === 'string' && record.maker.trim() ? record.maker.trim() : null,
    category: typeof record.category === 'string' && record.category.trim()
      ? record.category.trim()
      : null,
    source: 'barcode-catalog',
    barcode: record.barcode,
    per100g: { ...record.per100g },
    basis,
    serving: record.serving ? { ...record.serving } : null,
    nutritionProvenance,
  };
}

/**
 * identity 를 식약처 검색어로 바꾼다.
 *
 * **코리안넷 이름에는 제조사를 붙이지 않는다.** 실측(2026-08-27, 코리안넷 이름 N=85~86 을
 * 식약처에 실제로 던짐): 제조사를 붙인 질의는 **8.3%**, 뗀 질의는 **36.0%** 에서 결과가
 * 나왔다. 식약처 `FOOD_NM_KR` 은 제품명만 보기 때문이다. 코리안넷 파서가 내주는 `name` 은
 * 이미 제조사가 제거된 값이라 그대로 쓰면 된다.
 *
 * OFF·UPCitemdb 는 이름에 제조사가 섞여 있지 않아 브랜드가 검색을 좁혀준다.
 * **그쪽은 이번에 측정하지 않았으므로 기존 동작을 유지한다** — 안 잰 것을 바꾸지 않는다.
 */
export function barcodeIdentitySearchQuery(identity) {
  const name = typeof identity?.name === 'string' ? identity.name.trim() : '';
  if (name === '') return '';
  if (identity.provider === 'koreannet') return name;
  const brand = typeof identity.brand === 'string' ? identity.brand.trim() : '';
  return brand === '' ? name : `${brand} ${name}`;
}
