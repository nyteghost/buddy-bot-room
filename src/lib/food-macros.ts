export const FOOD_MACRO_TARGETS_KEY = "pixel-pals-food-macro-targets-v1";
export type MacroTargets = {
  calorieLimit: string;
  proteinTarget: string;
  carbLimit: string;
  fatLimit: string;
};
export type FoodMacros = MacroTargets & {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  basis: "unknown" | "serving" | "recipe";
  servings: string;
  amount: string;
  confirmed: boolean;
};
export type PortionMacros = { calories: number; protein: number; carbs: number; fat: number };
const number = (s: string, max: number, zero = true): number | null => {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s.trim())) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= max && (zero ? n >= 0 : n > 0) ? n : null;
};
export function readMacroTargets(value: unknown): MacroTargets | null {
  if (!value || typeof value !== "object") return null;
  const o = value as MacroTargets;
  if (
    ![o.calorieLimit, o.proteinTarget, o.carbLimit, o.fatLimit].every(
      (s) => typeof s === "string" && s.length <= 24,
    )
  )
    return null;
  if (
    number(o.calorieLimit, 20000, false) === null ||
    number(o.proteinTarget, 1000, false) === null ||
    (o.carbLimit.trim() && number(o.carbLimit, 3000) === null) ||
    (o.fatLimit.trim() && number(o.fatLimit, 2000) === null)
  )
    return null;
  return {
    calorieLimit: o.calorieLimit,
    proteinTarget: o.proteinTarget,
    carbLimit: o.carbLimit,
    fatLimit: o.fatLimit,
  };
}
export function readFoodMacros(value: unknown): FoodMacros | null {
  if (!value || typeof value !== "object") return null;
  const o = value as FoodMacros;
  const keys = [
    "calories",
    "protein",
    "carbs",
    "fat",
    "servings",
    "amount",
    "calorieLimit",
    "proteinTarget",
    "carbLimit",
    "fatLimit",
  ] as const;
  if (
    !keys.every((k) => typeof o[k] === "string" && o[k].length <= 24) ||
    !["unknown", "serving", "recipe"].includes(o.basis) ||
    typeof o.confirmed !== "boolean"
  )
    return null;
  return {
    ...Object.fromEntries(keys.map((k) => [k, o[k]])),
    basis: o.basis,
    confirmed: o.confirmed,
  } as FoodMacros;
}
/** Only recognize explicit, unambiguous source quantities. No AI or ingredient estimates. */
export function initialFoodMacros(raw: string): FoodMacros {
  const result: FoodMacros = {
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    basis: "unknown",
    servings: "",
    amount: "1",
    confirmed: false,
    calorieLimit: "",
    proteinTarget: "",
    carbLimit: "",
    fatLimit: "",
  };
  const labels: Record<string, "calories" | "protein" | "carbs" | "fat"> = {
    calories: "calories",
    proteincontent: "protein",
    protein: "protein",
    carbohydratecontent: "carbs",
    carbohydrates: "carbs",
    carbs: "carbs",
    fatcontent: "fat",
    fat: "fat",
  };
  for (const part of raw.split(" · ")) {
    const match = /^\s*([a-z]+)\s*:\s*(\d+(?:\.\d+)?)\s*(kcal|calories?|g|grams?)\s*$/i.exec(part);
    if (!match) continue;
    const key = labels[match[1]!.toLowerCase()];
    if (!key) continue;
    const energy = /^(kcal|calories?)$/i.test(match[3]!);
    if ((key === "calories") !== energy) continue;
    if (number(match[2]!, key === "calories" ? 20000 : 3000) !== null && !result[key])
      result[key] = match[2]!;
  }
  return result;
}
export function portionMacros(data: FoodMacros): PortionMacros | null {
  if (!data.confirmed || data.basis === "unknown") return null;
  const calories = number(data.calories, 20000),
    protein = number(data.protein, 3000),
    carbs = number(data.carbs, 3000),
    fat = number(data.fat, 2000);
  const portions = data.basis === "recipe" ? number(data.servings, 1000, false) : 1;
  const amount = number(data.amount, 100, false);
  if (
    calories === null ||
    protein === null ||
    carbs === null ||
    fat === null ||
    portions === null ||
    amount === null
  )
    return null;
  const factor = amount / portions;
  return {
    calories: calories * factor,
    protein: protein * factor,
    carbs: carbs * factor,
    fat: fat * factor,
  };
}
export type MacroResult = {
  verdict: "yes" | "no" | "unknown";
  reasons: string[];
  portion: PortionMacros | null;
  highCalories: boolean;
  lowProtein: boolean;
  highCarbs: boolean;
  highFat: boolean;
};
export function checkFoodMacros(data: FoodMacros): MacroResult {
  const portion = portionMacros(data),
    targets = readMacroTargets(data);
  const empty: MacroResult = {
    verdict: "unknown",
    reasons: [],
    portion,
    highCalories: false,
    lowProtein: false,
    highCarbs: false,
    highFat: false,
  };
  if (!portion)
    return {
      ...empty,
      reasons: [
        "Confirm the source nutrition, serving basis, and portion. Calories, protein, carbs and fat are all required; missing values are not zero.",
      ],
    };
  if (!targets)
    return {
      ...empty,
      reasons: [
        "Enter your meal calorie budget and protein minimum. Optional carb/fat limits must be valid numbers.",
      ],
    };
  const highCalories = portion.calories > +targets.calorieLimit,
    lowProtein = portion.protein < +targets.proteinTarget;
  const highCarbs = !!targets.carbLimit.trim() && portion.carbs > +targets.carbLimit,
    highFat = !!targets.fatLimit.trim() && portion.fat > +targets.fatLimit;
  const reasons = [
    highCalories ? "Calories exceed your meal budget." : "Calories fit your meal budget.",
    lowProtein ? "Protein is below your meal minimum." : "Protein meets your meal minimum.",
  ];
  if (highCarbs) reasons.push("Carbs exceed your optional meal limit.");
  if (highFat) reasons.push("Fat exceeds your optional meal limit.");
  return {
    verdict: highCalories || lowProtein || highCarbs || highFat ? "no" : "yes",
    reasons,
    portion,
    highCalories,
    lowProtein,
    highCarbs,
    highFat,
  };
}
export type MacroAlternative = { ingredient: string; suggestion: string };
export function macroAlternatives(ingredients: string[], result: MacroResult): MacroAlternative[] {
  if (result.verdict !== "no") return [];
  const found: MacroAlternative[] = [];
  const rules = [
    {
      match: /\brice\b/i,
      useful: result.highCarbs || result.highCalories,
      suggestion:
        "If it suits the dish, compare replacing part of the rice with cauliflower rice or non-starchy vegetables in a tested recipe variation. Use the new ingredients' own preparation guidance and recalculate the portion; they are not nutritionally equivalent.",
    },
    {
      match: /\bpasta\b/i,
      useful: result.highCarbs || result.highCalories,
      suggestion:
        "For a suitable dish, compare part of the pasta with vegetable noodles in a tested variation. Cooking and texture differ; calculate nutrition for the new portion rather than assuming a particular saving.",
    },
    {
      match: /\b(mayonnaise|mayo|sour cream)\b/i,
      useful: result.highCalories || result.highFat || result.lowProtein,
      suggestion:
        "For a cold dressing or topping, compare plain unsweetened Greek yogurt with this ingredient. Check product labels, flavor and dairy suitability; this is not a baking substitution.",
    },
    {
      match: /\bground (beef|turkey|chicken|pork|meat)\b|\b(beef|turkey|chicken|pork) mince\b/i,
      useful: result.highCalories || result.highFat,
      suggestion:
        "Compare a leaner version of the same ground meat using its nutrition label. A different product or recipe may need different preparation; use a tested variation.",
    },
    {
      match: /\b(yogurt|yoghurt)\b/i,
      useful: result.lowProtein || result.highCalories,
      suggestion:
        "Compare a plain unsweetened, higher-protein yogurt with the current product. Check the actual serving's calories, protein and dairy allergens.",
    },
    {
      match: /\bpasta\b/i,
      useful: result.lowProtein && !result.highCarbs,
      suggestion:
        "Compare a bean- or lentil-based pasta's label for the same portion. Check legume allergens and use that product's cooking instructions; do not assume the original timing applies.",
    },
    {
      match: /\bcheese\b/i,
      useful: result.highCalories || result.highFat,
      suggestion:
        "Compare a reduced-fat version of the same cheese. Check its calories and protein; melting and texture may differ, so review recipe suitability.",
    },
    {
      match: /\bcream\b/i,
      useful: result.highCalories || result.highFat,
      suggestion:
        "For a suitable sauce, compare a lighter dairy product in a tested variation of this recipe. Do not replace cream blindly in baking or whipping recipes.",
    },
  ];
  for (const rule of rules) {
    const ingredient = ingredients.find((s) => rule.match.test(s));
    if (ingredient && rule.useful && !found.some((s) => s.ingredient === ingredient))
      found.push({ ingredient, suggestion: rule.suggestion });
  }
  if (!found.length)
    found.push({
      ingredient: "No confident ingredient-specific match",
      suggestion: result.highCarbs
        ? "Look for a tested lower-carbohydrate variation of this recipe, then compare its portion nutrition. Do not make blind one-for-one flour or sugar replacements."
        : result.lowProtein
          ? "Consider a protein-containing side that suits your diet, such as beans or plain Greek yogurt. Include that side's calories and macros in the new portion total before checking again."
          : "Compare lower-calorie versions of the recipe's sauces or toppings using matching serving sizes. Use a tested recipe variation rather than an automatic ingredient swap.",
    });
  return found.slice(0, 4);
}
