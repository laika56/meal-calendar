const RETAIL_FORMATS = new Set(['EAN13', 'EAN8', 'UPCA', 'UPCE']);
const CORE_NUTRIENTS = ['kcal', 'proteinG', 'fatG', 'carbG'];

export function normalizeRetailBarcode(results) {
  if (!Array.isArray(results)) {
    throw new TypeError('normalizeRetailBarcode: results must be an array');
  }

  for (const result of results) {
    if (!RETAIL_FORMATS.has(result?.format)) continue;
    if (typeof result.text !== 'string') continue;
    const barcode = result.text.trim();
    if (barcode) return barcode;
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
