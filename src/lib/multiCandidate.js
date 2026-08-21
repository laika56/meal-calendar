import { scaleNutrients } from './units.js';
import { selectBestFood, hasNameMatch } from './quickFoodInput.js';

export function resolveMultiCandidate(piece, items) {
  // 이름이 실제로 맞아떨어질 때만 자동 기록 후보로 삼는다 — 엉뚱한 식품의 숫자가 들어가면 안 된다
  if (items.length === 0 || !hasNameMatch(piece.parsed.query, items)) {
    return { text: piece.text, ok: false };
  }

  const food = selectBestFood(piece.parsed.query, items);

  let amountG = piece.parsed.amountG;
  let quickInput = piece.parsed;
  if (!piece.parsed.ok) {
    // DB 가 1인분을 모르면 여기서도 포기한다. 개수를 g 으로 바꿀 근거가 없다
    if (!food.serving) return { text: piece.text, ok: false };
    // count 는 발주 18 이 붙여준다. 없으면 곱할 수가 없으니 포기한다 —
    // undefined 를 곱해서 NaN 을 기록하는 것보다 "못 알아들었다"가 낫다
    const count = piece.parsed.count;
    if (!Number.isFinite(count) || count <= 0) return { text: piece.text, ok: false };
    amountG = food.serving.amount * count;
    quickInput = {
      ...piece.parsed,
      ok: true,
      amountG,
      displayAmount: `${count}개`,
      estimated: true,
      servingSource: 'mfds-serving',
    };
  }

  // 미리 보여줄 kcal·완전성 판정. addSearchedFood 가 저장 시점에 똑같은 계산을
  // 다시 하므로(단일 진실 소스), 여기 값은 화면 표시 전용이고 저장 여부를 좌우하지 않는다.
  const scaled = scaleNutrients(food.per100g, amountG);
  const incomplete = Object.values(scaled).some((value) => value === null);

  return {
    text: piece.text,
    ok: true,
    incomplete,
    food,
    amountG,
    quickInput,
    kcal: scaled.kcal,
    name: quickInput.query ?? food.name,
    displayAmount: quickInput.estimated ? quickInput.displayAmount : `${amountG}g`,
    estimated: Boolean(quickInput.estimated),
  };
}
