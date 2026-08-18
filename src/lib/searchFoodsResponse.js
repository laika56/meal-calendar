/**
 * Cloud Functions search response boundary.
 *
 * The deployed endpoint returns `{ items, hasMore }`. Older callers and
 * fixtures may still supply an item array, but normalize that only here so
 * consumers never have to guess whether a long array means "more exists".
 */
export function normalizeSearchFoodsResponse(payload) {
  if (Array.isArray(payload)) return { items: payload, hasMore: false };
  if (typeof payload !== 'object' || payload === null) {
    throw new TypeError('search response must be an object with an items array');
  }
  if (!Array.isArray(payload.items)) throw new TypeError('search response items must be an array');
  return { items: payload.items, hasMore: payload.hasMore === true };
}
