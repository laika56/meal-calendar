import { canonicalBarcode } from './shared/barcodeCatalogLookup.js';

const ENDPOINT = 'https://api.upcitemdb.com/prod/trial/lookup';

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function lookupUpcItemIdentity(code, {
  fetchImpl = fetch,
  timeoutMs = 8_000,
} = {}) {
  const barcode = canonicalBarcode(code);
  if (barcode === null) throw new TypeError('upcitemdb barcode is invalid');
  const url = new URL(ENDPOINT);
  url.searchParams.set('upc', barcode);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response?.ok) throw new Error(`UPCitemdb HTTP ${response?.status ?? 'unknown'}`);
  const body = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.items)) {
    throw new TypeError('UPCitemdb response is malformed');
  }
  const exact = body.items.filter((item) => canonicalBarcode(String(item?.ean ?? '')) === barcode);
  if (exact.length !== 1) return null;
  const item = exact[0];
  const name = optionalText(item.title);
  if (name === null) throw new TypeError('UPCitemdb response is malformed');
  const image = Array.isArray(item.images) ? item.images.find((value) => optionalText(value) !== null) : null;
  return {
    barcode,
    name,
    brand: optionalText(item.brand),
    category: optionalText(item.category),
    imageUrl: optionalText(image),
    provider: 'upcitemdb',
  };
}
