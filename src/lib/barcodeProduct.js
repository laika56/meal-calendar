import { isValidBarcode, toEan13, upcEToUpcA } from './barcode.js';

const RETAIL_FORMATS = new Set(['EAN13', 'EAN8', 'UPCA', 'UPCE']);
const CORE_NUTRIENTS = ['kcal', 'proteinG', 'fatG', 'carbG'];

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
  if (!parsed.per100 || CORE_NUTRIENTS.some((key) => !Number.isFinite(parsed.per100[key]))) return null;
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
    serving: null,
  };
}
