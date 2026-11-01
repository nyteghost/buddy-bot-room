import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { FoodMacroCheck } from "@/components/food-macros";
import { initialFoodMacros, FOOD_MACRO_TARGETS_KEY, type FoodMacros } from "@/lib/food-macros";
const recipe = {
  title: "Dressing",
  ingredients: ["2 tbsp mayonnaise"],
  steps: ["Mix."],
  servings: "1 serving",
  nutrition:
    "calories: 500 kcal · proteinContent: 20 g · carbohydrateContent: 10 g · fatContent: 40 g",
  source: "",
};
function Harness() {
  const [value, setValue] = useState<FoodMacros>(initialFoodMacros(recipe.nutrition));
  return <FoodMacroCheck recipe={recipe} value={value} onChange={setValue} />;
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires confirmation, returns No with ingredient alternatives, and rechecks after changes", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Review nutrition, portion and meal targets"));
  expect(screen.getByText("Not enough information to judge")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Nutrition serving basis"), {
    target: { value: "serving" },
  });
  fireEvent.change(screen.getByLabelText("Meal calorie budget (kcal)"), {
    target: { value: "400" },
  });
  fireEvent.change(screen.getByLabelText("Meal protein minimum (g)"), { target: { value: "35" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("No — doesn’t fit your meal targets")).toBeInTheDocument();
  expect(screen.getByText(/compare plain unsweetened Greek yogurt/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Source calories (kcal)"), { target: { value: "350" } });
  expect(screen.getByText("Not enough information to judge")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Source protein (g)"), { target: { value: "40" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("Yes — fits your meal targets")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
it("remembers meal targets only on explicit action", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Review nutrition, portion and meal targets"));
  fireEvent.change(screen.getByLabelText("Meal calorie budget (kcal)"), {
    target: { value: "600" },
  });
  fireEvent.change(screen.getByLabelText("Meal protein minimum (g)"), { target: { value: "40" } });
  expect(localStorage.getItem(FOOD_MACRO_TARGETS_KEY)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remember meal targets" }));
  expect(JSON.parse(localStorage.getItem(FOOD_MACRO_TARGETS_KEY)!)).toEqual({
    calorieLimit: "600",
    proteinTarget: "40",
    carbLimit: "",
    fatLimit: "",
  });
  fireEvent.click(screen.getByRole("button", { name: "Forget remembered meal targets" }));
  expect(localStorage.getItem(FOOD_MACRO_TARGETS_KEY)).toBeNull();
  expect(screen.getByLabelText("Meal calorie budget (kcal)")).toHaveValue("600");
});

it("reuses only remembered targets for a new recipe, never old facts or confirmation", async () => {
  localStorage.setItem(
    FOOD_MACRO_TARGETS_KEY,
    JSON.stringify({
      calorieLimit: "600",
      proteinTarget: "40",
      carbLimit: "",
      fatLimit: "",
      calories: "100",
      confirmed: true,
      basis: "serving",
    }),
  );
  function Fresh() {
    const [value, setValue] = useState<FoodMacros>();
    return <FoodMacroCheck recipe={recipe} value={value} onChange={setValue} />;
  }
  render(<Fresh />);
  fireEvent.click(screen.getByText("Review nutrition, portion and meal targets"));
  await waitFor(() =>
    expect(screen.getByLabelText("Meal calorie budget (kcal)")).toHaveValue("600"),
  );
  expect(screen.getByLabelText("Source calories (kcal)")).toHaveValue("500");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByText("Not enough information to judge")).toBeInTheDocument();
});
