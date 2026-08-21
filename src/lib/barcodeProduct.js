import { isValidBarcode, toEan13, upcEToUpcA } from './barcode.js';

const RETAIL_FORMATS = new Set(['EAN13', 'EAN8', 'UPCA', 'UPCE']);
const CORE_NUTRIENTS = ['kcal', 'proteinG', 'fatG', 'carbG'];

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
