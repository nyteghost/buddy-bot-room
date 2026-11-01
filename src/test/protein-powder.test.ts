import { expect, it } from "vitest";
import {
  powderBase,
  powderCalculation,
  powderNutrition,
  readPowderAddition,
  readPowderLabel,
  type PowderPlan,
} from "@/lib/protein-powder";
import { initialFoodMacros } from "@/lib/food-macros";
import { newFoodSession, readFoodSession, validRecipe } from "@/lib/focus-food";
const plan: PowderPlan = {
  name: "Example whey",
  grams: "30",
  calories: "120",
  protein: "24",
  carbs: "3",
  fat: "1.5",
  portions: "4",
  sourceServings: "4",
  extraProtein: "10",
  baseBasis: "serving",
  baseConfirmed: true,
};
const raw = "calories: 400 kcal · protein: 30 g · carbs: 50 g · fat: 10 g";
it("weighs powder using protein per gram and counts all added nutrients", () => {
  expect(powderCalculation(plan)).toMatchObject({
    grams: 50,
    added: { calories: 200, protein: 40, carbs: 5, fat: 2.5 },
  });
});
it("rounds mass upward to 0.1g and recalculates nutrition from the actual mass", () => {
  const p = { ...plan, extraProtein: "1", portions: "1", protein: "23" };
  const result = powderCalculation(p)!;
  expect(result.grams).toBe(1.4);
  expect(result.added.protein).toBeCloseTo((1.4 * 23) / 30);
  expect(result.added.protein).toBeGreaterThanOrEqual(1);
});
it("distinguishes original source servings from final portions", () => {
  expect(initialFoodMacros(powderNutrition(raw, plan))).toMatchObject({
    calories: "450",
    protein: "40",
    carbs: "51.25",
    fat: "10.625",
  });
  expect(powderBase(raw, { ...plan, sourceServings: "8" })!.protein).toBe(240);
  expect(initialFoodMacros(powderNutrition(raw, { ...plan, sourceServings: "8" })).protein).toBe(
    "70",
  );
  expect(initialFoodMacros(powderNutrition(raw, { ...plan, baseBasis: "recipe" })).protein).toBe(
    "17.5",
  );
});
it("does not create full recipe totals from missing facts or unconfirmed basis", () => {
  expect(powderNutrition("protein: 30 g", plan)).toBe("");
  expect(powderNutrition(raw, { ...plan, baseConfirmed: false })).toBe("");
  expect(powderNutrition(raw, { ...plan, baseBasis: "unknown" })).toBe("");
  expect(powderNutrition(raw, { ...plan, sourceServings: "" })).toBe("");
});
it("rejects invalid labels, missing facts, zero protein, nonfinite values and impossible protein mass", () => {
  for (const patch of [
    { protein: "0" },
    { grams: "0" },
    { protein: "31" },
    { calories: "" },
    { fat: "-1" },
    { protein: "Infinity" },
    { grams: "1e2" },
    { name: "Bad\nlabel" },
  ])
    expect(readPowderLabel({ ...plan, ...patch })).toBeNull();
  expect(readPowderLabel({ ...plan, fat: "0", carbs: "0" })).not.toBeNull();
  for (const patch of [
    { extraProtein: "0" },
    { portions: "0" },
    { extraProtein: "NaN" },
    { portions: "1000" },
  ])
    expect(powderCalculation({ ...plan, ...patch })).toBeNull();
});
it("persists the powder calculation and original recipe information without changing instructions", () => {
  const recipe = {
    title: "Oats",
    ingredients: ["Oats"],
    steps: ["Follow original method."],
    servings: "4 servings",
    nutrition: raw,
    source: "",
  };
  const ingredient = "50.0 g Example whey (protein powder; calculated addition)";
  const powderAddition = {
    plan,
    originalIngredients: recipe.ingredients,
    originalNutrition: raw,
    originalServings: recipe.servings,
    ingredient,
  };
  const modified = validRecipe({
    ...recipe,
    ingredients: [...recipe.ingredients, ingredient],
    servings: "4 portions",
    nutrition: powderNutrition(raw, plan),
    powderAddition,
  })!;
  const restored = readFoodSession(JSON.stringify(newFoodSession(modified)))!;
  expect(restored.recipe.powderAddition).toEqual(powderAddition);
  expect(restored.recipe.steps).toEqual(recipe.steps);
  expect(restored.recipe.powderAddition!.originalIngredients).toEqual(["Oats"]);
  expect(readPowderAddition({ ...powderAddition, plan: { ...plan, protein: "0" } })).toBeNull();
  expect(validRecipe({ ...modified, powderAddition: {} })!.nutrition).toBe("");
});
