export async function resolveBarcodeSources(barcode, { lookupMine, lookupShared, lookupOff, lookupIdentity }) {
  if (typeof barcode !== 'string' || !barcode) {
    throw new TypeError('resolveBarcodeSources: barcode must be a non-empty string');
  }
  if (typeof lookupShared !== 'function' || typeof lookupOff !== 'function') {
    throw new TypeError('resolveBarcodeSources: lookup dependencies must be functions');
  }

  // 내가 전에 영양성분표를 찍어 확인한 제품이 가장 신뢰도 높다. 그래서 공용보다 먼저 본다.
  // 국내 바코드 커버리지가 낮아(2026-08-26 실측: 공용 카탈로그 2,109개) 같은 제품을
  // 매번 다시 찍는 일이 실제로 일어난다.
  //
  // 선택 의존성이다 — 안 넘기면 아래 3단계가 그대로 돈다.
  // 실패는 삼킨다: 오프라인이거나 규칙이 막았다고 공용·OFF 까지 포기하면
  // 되던 조회도 안 되게 만든다.
  if (typeof lookupMine === 'function') {
    try {
      const mine = await lookupMine(barcode);
      if (mine !== null && mine !== undefined) {
        return { food: mine, source: 'mine', sharedUnavailable: false, offUnavailable: false };
      }
    } catch {
      // 다음 단계로 계속한다
    }
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
    const offResult = await lookupOff(barcode);
    const isBundle = offResult !== null
      && typeof offResult === 'object'
      && (Object.hasOwn(offResult, 'food') || Object.hasOwn(offResult, 'identity'));
    const food = isBundle ? (offResult.food ?? null) : offResult;
    const identity = isBundle ? (offResult.identity ?? null) : null;
    if (identity !== null && food === null) {
      return {
        food: null, identity, source: 'off-identity',
        sharedUnavailable, offUnavailable: false, upcUnavailable: false,
      };
    }
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

export function barcodeLookupFailureMessage(barcode, result) {
  if (typeof barcode !== 'string' || !barcode) {
    throw new TypeError('barcodeLookupFailureMessage: barcode must be a non-empty string');
  }
  if (result?.sharedUnavailable && result?.offUnavailable && result?.upcUnavailable) {
    return `바코드 ${barcode}는 읽었지만 제품 조회 서비스에 연결하지 못했습니다. 직접 입력해 주세요.`;
  }
  return `바코드 ${barcode}는 읽었지만 제품 정보를 찾지 못했습니다. 제품명이나 영양성분표로 입력해 주세요.`;
}
