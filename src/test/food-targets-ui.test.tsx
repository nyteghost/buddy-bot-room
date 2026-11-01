import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FoodTargetsPanel, FoodTargetsProvider } from "@/components/food-targets";
import { FoodMacroCheck } from "@/components/food-macros";
import { FOOD_MACRO_TARGETS_KEY, initialFoodMacros } from "@/lib/food-macros";
const recipe = {
  title: "Meal",
  servings: "1",
  source: "",
  ingredients: [],
  steps: [],
  nutrition: "",
};
beforeEach(() => localStorage.clear());
afterEach(cleanup);
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
it("uses one shared editable meal budget for recipes and restaurants, with explicit remembering", () => {
  const facts = {
    ...initialFoodMacros("calories: 500 kcal · protein: 40 g · carbs: 50 g · fat: 15 g"),
    basis: "serving" as const,
    confirmed: true,
  };
  render(
    <FoodTargetsProvider>
      <FoodTargetsPanel />
      <FoodMacroCheck recipe={recipe} value={facts} onChange={() => {}} />
      <FoodMacroCheck context="restaurant" recipe={recipe} value={facts} onChange={() => {}} />
    </FoodTargetsProvider>,
  );
  fill("Meal calorie budget (kcal)", "600");
  fill("Meal protein minimum (g)", "35");
  expect(screen.getAllByText("Yes — fits your meal targets")).toHaveLength(2);
  fill("Meal calorie budget (kcal)", "400");
  expect(screen.getAllByText("No — doesn’t fit your meal targets")).toHaveLength(2);
  expect(localStorage.getItem(FOOD_MACRO_TARGETS_KEY)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remember meal targets" }));
  expect(JSON.parse(localStorage.getItem(FOOD_MACRO_TARGETS_KEY)!)).toEqual({
    calorieLimit: "400",
    proteinTarget: "35",
    carbLimit: "",
    fatLimit: "",
  });
});
it("divides only an explicitly entered daily plan and leaves optional caps unchanged", () => {
  render(
    <FoodTargetsProvider>
      <FoodTargetsPanel />
    </FoodTargetsProvider>,
  );
  fill("Daily calorie target (kcal)", "2400");
  fill("Daily protein target (g)", "180");
  fill("Daily carb target (g, optional)", "250");
  fill("Daily fat target (g, optional)", "75");
  fill("Meals to divide across", "3");
  fireEvent.click(screen.getByRole("button", { name: "Use equal-split meal budget" }));
  expect(screen.getByLabelText("Meal calorie budget (kcal)")).toHaveValue("800");
  expect(screen.getByLabelText("Meal protein minimum (g)")).toHaveValue("60");
  expect(screen.getByLabelText("Meal carb limit (g, optional)")).toHaveValue("");
  expect(localStorage.getItem(FOOD_MACRO_TARGETS_KEY)).toBeNull();
});
it("rejects invalid daily inputs rather than prescribing or dividing by zero", () => {
  render(
    <FoodTargetsProvider>
      <FoodTargetsPanel />
    </FoodTargetsProvider>,
  );
  fill("Daily calorie target (kcal)", "2400");
  fill("Daily protein target (g)", "180");
  fill("Meals to divide across", "0");
  fireEvent.click(screen.getByRole("button", { name: "Use equal-split meal budget" }));
  expect(screen.getByLabelText("Meal calorie budget (kcal)")).toHaveValue("");
  expect(within(screen.getByRole("status")).getByText(/1–12 meals/)).toBeInTheDocument();
});
