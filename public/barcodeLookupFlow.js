export async function resolveBarcodeSources(barcode, { lookupShared, lookupOff, lookupIdentity }) {
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
  let offUnavailable = false;
  try {
    const food = await lookupOff(barcode);
    if (food !== null || typeof lookupIdentity !== 'function') {
      return { food, source: food === null ? null : 'off', sharedUnavailable, offUnavailable: false };
    }
  } catch {
    offUnavailable = true;
    if (typeof lookupIdentity !== 'function') {
      return { food: null, source: null, sharedUnavailable, offUnavailable: true };
    }
  }
  try {
    const identity = await lookupIdentity(barcode);
    return {
      food: null, identity,
      source: identity === null ? null : 'upcitemdb',
      sharedUnavailable, offUnavailable, upcUnavailable: false,
    };
  } catch {
    return {
      food: null, identity: null, source: null,
      sharedUnavailable, offUnavailable, upcUnavailable: true,
    };
  }
}
