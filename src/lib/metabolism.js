export class ImpossibleTargetError extends Error {}

const GOALS = {
  diet: { calorieMultiplier: 0.85, proteinPerKg: 2.0 },
  leanbulk: { calorieMultiplier: 1.05, proteinPerKg: 1.8 },
  bulk: { calorieMultiplier: 1.15, proteinPerKg: 1.6 },
};

function formatValue(value) {
  return Number.isNaN(value) ? 'NaN' : JSON.stringify(value);
}

function assertNumber(value, funcName, label) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError(`${funcName}: ${label} must be a number, got ${formatValue(value)}`);
  }
}

function assertInRange(value, minimum, maximum, funcName, label) {
  if (value < minimum || value > maximum) {
    throw new RangeError(
      `${funcName}: ${label} must be between ${minimum} and ${maximum}, got ${value}`,
    );
  }
}

export function calcBMR({ sex, weightKg, heightCm, age }) {
  if (sex !== 'male' && sex !== 'female') {
    throw new TypeError(
      `calcBMR: sex must be "male" or "female", got ${JSON.stringify(sex)}`,
    );
  }

  for (const [label, value, minimum, maximum] of [
    ['weightKg', weightKg, 20, 300],
    ['heightCm', heightCm, 100, 250],
    ['age', age, 10, 120],
  ]) {
    assertNumber(value, 'calcBMR', label);
    assertInRange(value, minimum, maximum, 'calcBMR', label);
  }

  const sexAdjustment = sex === 'male' ? 5 : -161;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + sexAdjustment;
}

export function calcTDEE(bmr, weeklyWorkouts) {
  assertNumber(bmr, 'calcTDEE', 'bmr');

  if (!Number.isInteger(weeklyWorkouts) || weeklyWorkouts < 0 || weeklyWorkouts > 7) {
    throw new RangeError(
      `calcTDEE: weeklyWorkouts must be an integer between 0 and 7, got ${JSON.stringify(weeklyWorkouts)}`,
    );
  }

  const activityMultiplier = weeklyWorkouts === 0 ? 1.2
    : weeklyWorkouts <= 3 ? 1.375
      : weeklyWorkouts <= 5 ? 1.55
        : 1.725;
  return bmr * activityMultiplier;
}

export function calcTargets({ tdee, weightKg, goal }) {
  assertNumber(tdee, 'calcTargets', 'tdee');
  assertNumber(weightKg, 'calcTargets', 'weightKg');

  if (!Object.hasOwn(GOALS, goal)) {
    throw new TypeError(
      `calcTargets: goal must be one of ${Object.keys(GOALS).join(', ')}, got ${JSON.stringify(goal)}`,
    );
  }

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
