export async function resolveBarcodeSources(barcode, { lookupShared, lookupOff }) {
  if (typeof barcode !== 'string' || !barcode) {
    throw new TypeError('resolveBarcodeSources: barcode must be a non-empty string');
  }
  if (typeof lookupShared !== 'function' || typeof lookupOff !== 'function') {
    throw new TypeError('resolveBarcodeSources: lookup dependencies must be functions');
  }
  let sharedUnavailable = false;
  try {
    const food = await lookupShared(barcode);
    if (food !== null) {
      return { food, source: 'shared', sharedUnavailable: false, offUnavailable: false };
    }
  } catch {
    sharedUnavailable = true;
  }
  try {
    const food = await lookupOff(barcode);
    return {
      food,
      source: food === null ? null : 'off',
      sharedUnavailable,
      offUnavailable: false,
    };
  } catch {
    return { food: null, source: null, sharedUnavailable, offUnavailable: true };
  }
}
