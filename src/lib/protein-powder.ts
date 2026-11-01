import { initialFoodMacros, type PortionMacros } from "./food-macros";

export const POWDER_PROFILE_KEY = "pixel-pals-protein-powder-v1";
export type PowderLabel = {
  name: string;
  grams: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};
export type PowderPlan = PowderLabel & {
  extraProtein: string;
  portions: string;
  sourceServings: string;
  baseBasis: "unknown" | "serving" | "recipe";
  baseConfirmed: boolean;
};
export type PowderAddition = {
  plan: PowderPlan;
  originalNutrition: string;
  originalServings: string;
  originalIngredients: string[];
  ingredient: string;
};
export const emptyPowderLabel = (): PowderLabel => ({
  name: "",
  grams: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
});
const n = (value: string, max: number, positive = false): number | null => {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) || value.length > 24) return null;
  const number = +value;
  return Number.isFinite(number) && number <= max && number >= 0 && (!positive || number > 0)
    ? number
    : null;
};
export function readPowderLabel(value: unknown): PowderLabel | null {
  if (!value || typeof value !== "object") return null;
  const p = value as PowderLabel;
  if (
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 120 ||
    /[\r\n]/.test(p.name) ||
    ![p.grams, p.calories, p.protein, p.carbs, p.fat].every(
      (v) => typeof v === "string" && v.length <= 24,
    )
  )
    return null;
  const grams = n(p.grams, 1000, true),
    protein = n(p.protein, 1000, true),
    carbs = n(p.carbs, 1000),
    fat = n(p.fat, 1000);
  if (
    grams === null ||
    protein === null ||
    carbs === null ||
    fat === null ||
    n(p.calories, 10000, true) === null ||
    protein > grams ||
    carbs > grams ||
    fat > grams
  )
    return null;
  return {
    name: p.name.trim(),
    grams: p.grams,
    calories: p.calories,
    protein: p.protein,
    carbs: p.carbs,
    fat: p.fat,
  };
}
export function powderCalculation(
  plan: PowderPlan,
): { grams: number; labelServings: number; added: PortionMacros } | null {
  const label = readPowderLabel(plan),
    extra = typeof plan.extraProtein === "string" ? n(plan.extraProtein, 200, true) : null,
    portions = typeof plan.portions === "string" ? n(plan.portions, 100, true) : null;
  if (!label || extra === null || portions === null) return null;
  // Round UP to the next tenth of a gram, then use that actual mass for all added nutrients.
  const grams = Math.ceil(((extra * portions * +label.grams) / +label.protein - 1e-9) * 10) / 10;
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) return null;
  const labelServings = grams / +label.grams;
  return {
    grams,
    labelServings,
    added: {
      calories: +label.calories * labelServings,
      protein: +label.protein * labelServings,
      carbs: +label.carbs * labelServings,
      fat: +label.fat * labelServings,
    },
  };
}
export function powderBase(raw: string, plan: PowderPlan): PortionMacros | null {
  if (
    !plan.baseConfirmed ||
    !["serving", "recipe"].includes(plan.baseBasis) ||
    n(plan.portions, 100, true) === null
  )
    return null;
  const source = initialFoodMacros(raw);
  const entries = (["calories", "protein", "carbs", "fat"] as const).map(
    (k) => [k, n(source[k], k === "calories" ? 20000 : 3000)] as const,
  );
  if (entries.some(([, value]) => value === null)) return null;
  if (plan.baseBasis === "serving" && n(plan.sourceServings, 100, true) === null) return null;
  const multiplier = plan.baseBasis === "serving" ? +plan.sourceServings : 1;
  return Object.fromEntries(
    entries.map(([key, value]) => [key, value! * multiplier]),
  ) as PortionMacros;
}
export function powderNutrition(raw: string, plan: PowderPlan): string {
  const calculation = powderCalculation(plan),
    base = powderBase(raw, plan);
  if (!calculation || !base) return "";
  const combined = (key: keyof PortionMacros) =>
    Number(((base[key] + calculation.added[key]) / +plan.portions).toFixed(4));
  return `calories: ${combined("calories")} kcal · proteinContent: ${combined("protein")} g · carbohydrateContent: ${combined("carbs")} g · fatContent: ${combined("fat")} g`;
}
export function readPowderAddition(value: unknown): PowderAddition | null {
  if (!value || typeof value !== "object") return null;
  const a = value as PowderAddition,
    p = a.plan;
  if (
    !p ||
    !readPowderLabel(p) ||
    !powderCalculation(p) ||
    !["unknown", "serving", "recipe"].includes(p.baseBasis) ||
    typeof p.baseConfirmed !== "boolean" ||
    typeof p.sourceServings !== "string" ||
    p.sourceServings.length > 24 ||
    typeof a.originalNutrition !== "string" ||
    a.originalNutrition.length > 2000 ||
    typeof a.originalServings !== "string" ||
    a.originalServings.length > 240 ||
    !Array.isArray(a.originalIngredients) ||
    a.originalIngredients.length > 149 ||
    !a.originalIngredients.every(
      (i) => typeof i === "string" && i.length > 0 && i.length <= 1200,
    ) ||
    typeof a.ingredient !== "string" ||
    a.ingredient.length > 1200
  )
    return null;
  return {
    plan: {
      ...readPowderLabel(p)!,
      extraProtein: p.extraProtein,
      portions: p.portions,
      sourceServings: p.sourceServings,
      baseBasis: p.baseBasis,
      baseConfirmed: p.baseConfirmed,
    },
    originalNutrition: a.originalNutrition,
    originalServings: a.originalServings,
    originalIngredients: [...a.originalIngredients],
    ingredient: a.ingredient,
  };
}
