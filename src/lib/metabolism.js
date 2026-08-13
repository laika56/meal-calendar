export class ImpossibleTargetError extends Error {}

const GOALS = {
  diet: { calorieMultiplier: 0.85, proteinPerKg: 2.0 },
  leanbulk: { calorieMultiplier: 1.05, proteinPerKg: 1.8 },
  bulk: { calorieMultiplier: 1.15, proteinPerKg: 1.6 },
};

function assertNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new TypeError();
}

function assertInRange(value, minimum, maximum) {
  if (value < minimum || value > maximum) throw new RangeError();
}

export function calcBMR({ sex, weightKg, heightCm, age }) {
  if (sex !== 'male' && sex !== 'female') throw new TypeError();

  for (const [value, minimum, maximum] of [
    [weightKg, 20, 300],
    [heightCm, 100, 250],
    [age, 10, 120],
  ]) {
    assertNumber(value);
    assertInRange(value, minimum, maximum);
  }

  const sexAdjustment = sex === 'male' ? 5 : -161;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + sexAdjustment;
}

export function calcTDEE(bmr, weeklyWorkouts) {
  if (!Number.isInteger(weeklyWorkouts) || weeklyWorkouts < 0 || weeklyWorkouts > 7) {
    throw new RangeError();
  }

  const activityMultiplier = weeklyWorkouts === 0 ? 1.2
    : weeklyWorkouts <= 3 ? 1.375
      : weeklyWorkouts <= 5 ? 1.55
        : 1.725;
  return bmr * activityMultiplier;
}

export function calcTargets({ tdee, weightKg, goal }) {
  const { calorieMultiplier, proteinPerKg } = GOALS[goal];
  const kcal = tdee * calorieMultiplier;
  const proteinG = weightKg * proteinPerKg;
  const fatG = (kcal * 0.25) / 9;
  const carbG = (kcal - proteinG * 4 - fatG * 9) / 4;

  if (carbG < 0) {
    throw new ImpossibleTargetError(`Impossible target: carbG ${carbG}, kcal ${kcal}`);
  }

  return {
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbG: Math.round(carbG),
  };
}

export function buildGoalProfile({ sex, weightKg, heightCm, age, weeklyWorkouts, goal }) {
  const bmr = calcBMR({ sex, weightKg, heightCm, age });
  const tdee = calcTDEE(bmr, weeklyWorkouts);
  const targets = calcTargets({ tdee, weightKg, goal });

  return { bmr: Math.round(bmr), tdee: Math.round(tdee), ...targets };
}
