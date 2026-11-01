import { describe, expect, it } from "vitest";
import {
  checkFoodMacros,
  initialFoodMacros,
  macroAlternatives,
  portionMacros,
  readFoodMacros,
  readMacroTargets,
} from "@/lib/food-macros";
import { newFoodSession, readFoodSession } from "@/lib/focus-food";
const good = () => ({
  ...initialFoodMacros(""),
  calories: "500",
  protein: "40",
  carbs: "50",
  fat: "15",
  basis: "serving" as const,
  confirmed: true,
  calorieLimit: "600",
  proteinTarget: "35",
});
describe("source nutrition parsing", () => {
  it("recognizes explicit source kcal and grams without assuming a serving basis", () => {
    const parsed = initialFoodMacros(
      "calories: 500 kcal · proteinContent: 40 g · carbohydrateContent: 50 grams · fatContent: 15g · saturatedFatContent: 4 g",
    );
    expect(parsed).toMatchObject({
      calories: "500",
      protein: "40",
      carbs: "50",
      fat: "15",
      basis: "unknown",
      confirmed: false,
    });
    expect(checkFoodMacros(parsed).verdict).toBe("unknown");
  });
  it.each([
    "calories: 2000 kJ",
    "proteinContent: 20 mg",
    "fatContent: <1 g",
    "proteinContent: 20-30 g",
    "calories: 500",
    "proteinContent: -20 g",
  ])("does not invent values for %s", (raw) => {
    const parsed = initialFoodMacros(raw);
    expect(parsed.calories).toBe("");
    expect(parsed.protein).toBe("");
    expect(parsed.fat).toBe("");
  });
});
describe("portion and target checks", () => {
  it("compares a confirmed portion against explicit targets", () => {
    expect(checkFoodMacros(good())).toMatchObject({
      verdict: "yes",
      portion: { calories: 500, protein: 40, carbs: 50, fat: 15 },
    });
    expect(checkFoodMacros({ ...good(), calorieLimit: "400" })).toMatchObject({
      verdict: "no",
      highCalories: true,
    });
    expect(checkFoodMacros({ ...good(), proteinTarget: "50" })).toMatchObject({
      verdict: "no",
      lowProtein: true,
    });
  });
  it("scales whole-recipe facts by equal portions, and source servings by meal amount", () => {
    expect(
      portionMacros({
        ...good(),
        calories: "2000",
        protein: "160",
        carbs: "200",
        fat: "60",
        basis: "recipe",
        servings: "4",
      }),
    ).toEqual({ calories: 500, protein: 40, carbs: 50, fat: 15 });
    expect(portionMacros({ ...good(), amount: "1.5" })).toEqual({
      calories: 750,
      protein: 60,
      carbs: 75,
      fat: 22.5,
    });
  });
  it("treats a blank macro as missing and accepts a genuine zero", () => {
    expect(checkFoodMacros({ ...good(), fat: "" }).verdict).toBe("unknown");
    expect(checkFoodMacros({ ...good(), fat: "0" }).verdict).toBe("yes");
  });
  it.each([
    { confirmed: false },
    { basis: "unknown" as const },
    { basis: "recipe" as const, servings: "0" },
    { amount: "NaN" },
    { amount: "-1" },
    { calorieLimit: "" },
    { proteinTarget: "0" },
    { fatLimit: "n/a" },
  ])("does not return a verdict for incomplete or invalid input %j", (patch) =>
    expect(checkFoodMacros({ ...good(), ...patch }).verdict).toBe("unknown"),
  );
  it("uses optional carb/fat limits only when explicitly entered", () => {
    expect(checkFoodMacros({ ...good(), carbs: "100" }).verdict).toBe("yes");
    expect(checkFoodMacros({ ...good(), carbLimit: "40" })).toMatchObject({
      verdict: "no",
      highCarbs: true,
    });
    expect(checkFoodMacros({ ...good(), fatLimit: "10" })).toMatchObject({
      verdict: "no",
      highFat: true,
    });
  });
  it("does not round away a small target failure", () =>
    expect(checkFoodMacros({ ...good(), calories: "600.01" }).verdict).toBe("no"));
});
describe("reviewable ingredient alternatives and recovery", () => {
  it("suggests for the actual ingredient only on a No, without changing a recipe or claiming revised nutrition", () => {
    const ingredients = ["2 tbsp mayonnaise", "1 cup rice"],
      original = [...ingredients];
    const result = checkFoodMacros({ ...good(), calorieLimit: "400" });
    expect(macroAlternatives(ingredients, result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredient: "2 tbsp mayonnaise",
          suggestion: expect.stringContaining("Greek yogurt"),
        }),
      ]),
    );
    expect(ingredients).toEqual(original);
    expect(macroAlternatives(ingredients, checkFoodMacros(good()))).toEqual([]);
  });
  it("provides a carb-specific alternative only for a chosen carb limit", () => {
    const result = checkFoodMacros({ ...good(), carbLimit: "40" });
    expect(macroAlternatives(["1 cup rice"], result)[0]?.suggestion).toContain("cauliflower rice");
  });
  it("validates remembered targets and keeps cooking progress if nutrition state is malformed", () => {
    expect(readMacroTargets(good())).toMatchObject({ calorieLimit: "600", proteinTarget: "35" });
    expect(readMacroTargets({ ...good(), calorieLimit: "Infinity" })).toBeNull();
    expect(readFoodMacros({ ...good(), confirmed: "yes" })).toBeNull();
    const base = newFoodSession({
      title: "Recipe",
      ingredients: ["Ingredient"],
      steps: ["Follow the recipe."],
      source: "",
      servings: "",
      nutrition: "",
    });
    expect(readFoodSession(JSON.stringify({ ...base, macroCheck: good() }))?.macroCheck).toEqual(
      good(),
    );
    expect(readFoodSession(JSON.stringify({ ...base, macroCheck: { bad: true } }))).toEqual(base);
  });
});
