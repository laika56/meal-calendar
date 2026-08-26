// 내가 이미 확인한 바코드 제품을 users/{uid}/barcodes/{code} 에 저장하기 위한 변환.
//
// **공용 캐시(`foods/`)에는 쓰지 않는다.** 개인 스캔 이력을 공용 카탈로그에 올리지
// 않는다는 규칙(docs/NEXT.md「개인 스캔 이력을 학습하거나 저장하지 않고」)이 있고,
// 그 규칙은 *공유*를 막는 것이다. 내 기록을 나만 다시 읽는 건 그 대상이 아니다.
//
// **Firestore 는 `undefined` 를 거부한다** — 필드 하나만 undefined 여도 setDoc 이
// 통째로 실패한다. 이 프로젝트에서 실제로 겪은 사고라(2026-08-14) 저장 직전에
// undefined 를 전부 없앤다. 값이 없으면 null 이다.

const CORE_NUTRIENTS = ['carbG', 'proteinG', 'fatG'];

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function trimmedOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 저장 가능한 1회분인지 본다. 부분적으로 깨진 serving 은 통째로 버린다. */
function normalizeServing(serving) {
  if (!serving || typeof serving !== 'object' || Array.isArray(serving)) return null;
  const amount = finiteOrNull(serving.amount);
  const unit = trimmedOrNull(serving.unit);
  if (amount === null || amount <= 0 || unit === null) return null;
  return { amount, unit };
}

/**
 * 조회 결과 food 를 Firestore 문서로 바꾼다.
 * 저장할 수 없는 것(열량 없음 등)이면 null — 모르는 값을 채우지 않는다.
 */
export function toMyBarcodeRecord(food, savedAtIso) {
  if (!food || typeof food !== 'object' || Array.isArray(food)) return null;

  const barcode = trimmedOrNull(food.barcode);
  const name = trimmedOrNull(food.name);
  if (barcode === null || name === null) return null;

  const kcal = finiteOrNull(food.per100g?.kcal);
  if (kcal === null) return null; // 열량 없는 것을 캐시해봐야 다음에도 못 쓴다

  if (typeof savedAtIso !== 'string' || !savedAtIso) {
    throw new TypeError('toMyBarcodeRecord: savedAtIso must be a non-empty string');
  }

  const per100g = { kcal };
  for (const key of CORE_NUTRIENTS) {
    per100g[key] = finiteOrNull(food.per100g?.[key]);
  }

  return {
    barcode,
    name,
    maker: trimmedOrNull(food.maker),
    // 어디서 온 값인지 남긴다. 나중에 공용 카탈로그가 넓어졌을 때
    // 내 캐시가 낡은 값을 계속 이기고 있는지 판단할 근거가 된다.
    origin: trimmedOrNull(food.source) ?? 'manual',
    per100g,
    basis: food.basis === 'mL' || food.basis === 'ml' ? 'mL' : 'g',
    serving: normalizeServing(food.serving),
    savedAt: savedAtIso,
  };
}

/**
 * Firestore 문서를 조회 결과 food 형태로 되돌린다.
 * 형태가 어긋나면 null — 낡거나 깨진 문서 때문에 스캔 전체가 죽지 않게 한다.
 */
export function fromMyBarcodeRecord(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const barcode = trimmedOrNull(data.barcode);
  const name = trimmedOrNull(data.name);
  if (barcode === null || name === null) return null;

  const kcal = finiteOrNull(data.per100g?.kcal);
  if (kcal === null) return null;

  const per100g = { kcal };
  for (const key of CORE_NUTRIENTS) {
    per100g[key] = finiteOrNull(data.per100g?.[key]);
  }

  return {
    foodKey: `mine_${barcode}`,
    name,
    maker: trimmedOrNull(data.maker),
    source: 'mine',
    barcode,
    per100g,
    basis: data.basis === 'mL' ? 'mL' : 'g',
    serving: normalizeServing(data.serving),
  };
}

/** 저장 경로의 문서 id. 조회와 저장이 같은 규칙을 쓰게 한 곳에 둔다. */
export function myBarcodeDocId(barcode) {
  const trimmed = trimmedOrNull(barcode);
  if (trimmed === null) return null;
  // Firestore 문서 id 는 `/` 를 못 쓴다. 바코드는 숫자만이라 정상값은 안 걸리지만,
  // 검증을 통과하지 못한 입력이 흘러들어와 경로를 깨뜨리는 일은 막는다.
  return /^\d{8,14}$/u.test(trimmed) ? trimmed : null;
}
