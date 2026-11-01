import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ProteinPowder } from "@/components/protein-powder";
import { FoodTargetsProvider, FoodTargetsPanel } from "@/components/food-targets";
import { POWDER_PROFILE_KEY } from "@/lib/protein-powder";
import type { FoodRecipe } from "@/lib/focus-food";
const recipe: FoodRecipe = {
  title: "Oats",
  ingredients: ["Oats"],
  steps: ["Follow original method."],
  servings: "4 servings",
  nutrition: "calories: 400 kcal · protein: 30 g · carbs: 50 g · fat: 10 g",
  source: "",
};
function Harness() {
  const [value, setValue] = useState(recipe);
  return (
    <>
      <ProteinPowder recipe={value} onChange={setValue} />
      <output data-testid="recipe">{JSON.stringify(value)}</output>
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function label() {
  fireEvent.click(screen.getByRole("button", { name: "Add protein powder" }));
  for (const [key, value] of [
    ["Protein powder name / flavour", "Example whey"],
    ["Powder weight per label serving (g)", "30"],
    ["Protein per label serving (g)", "24"],
    ["Calories per label serving (kcal)", "120"],
    ["Carbs per label serving (g)", "3"],
    ["Fat per label serving (g)", "1.5"],
    ["Portions in the finished recipe", "4"],
    ["Extra protein wanted per portion (g)", "10"],
  ])
    fill(key!, value!);
}
it("previews the measured amount and applies only after explicit suitability review, with original facts retained", () => {
  render(<Harness />);
  label();
  expect(screen.getByText("Weigh 50.0 g of Example whey for the whole recipe")).toBeInTheDocument();
  const apply = screen.getByRole("button", { name: "Apply measured powder addition" });
  expect(apply).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I checked this product’s allergens/));
  fireEvent.click(apply);
  const modified = JSON.parse(screen.getByTestId("recipe").textContent!);
  expect(modified.ingredients).toHaveLength(2);
  expect(modified.steps).toEqual(recipe.steps);
  expect(modified.nutrition).toBe("");
  expect(modified.powderAddition.originalNutrition).toBe(recipe.nutrition);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove powder addition" }));
  expect(JSON.parse(screen.getByTestId("recipe").textContent!)).toMatchObject({
    ingredients: ["Oats"],
    steps: recipe.steps,
  });
});
it("uses confirmed original nutrition and the shared protein shortfall, counting powder calories", () => {
  render(
    <FoodTargetsProvider>
      <FoodTargetsPanel />
      <Harness />
    </FoodTargetsProvider>,
  );
  label();
  fill("Meal calorie budget (kcal)", "600");
  fill("Meal protein minimum (g)", "40");
  fill("Original nutrition describes", "serving");
  fill("Source servings in the original whole recipe", "4");
  fireEvent.click(screen.getByLabelText(/I checked the original nutrition/));
  fireEvent.click(screen.getByRole("button", { name: "Use my meal protein shortfall" }));
  expect(screen.getByLabelText("Extra protein wanted per portion (g)")).toHaveValue("10");
  fill("Meal protein minimum (g)", "25");
  fireEvent.click(screen.getByRole("button", { name: "Use my meal protein shortfall" }));
  expect(screen.getByLabelText("Extra protein wanted per portion (g)")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Apply measured powder addition" })).toBeDisabled();
  fill("Meal protein minimum (g)", "40");
  fireEvent.click(screen.getByRole("button", { name: "Use my meal protein shortfall" }));
  fireEvent.click(screen.getByLabelText(/I checked this product’s allergens/));
  fireEvent.click(screen.getByRole("button", { name: "Apply measured powder addition" }));
  expect(JSON.parse(screen.getByTestId("recipe").textContent!).nutrition).toContain(
    "calories: 450 kcal",
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove powder addition" }));
  expect(JSON.parse(screen.getByTestId("recipe").textContent!)).toEqual(recipe);
});
it("remembers only a powder label explicitly, never an old dose or confirmation", () => {
  render(<Harness />);
  label();
  expect(localStorage.getItem(POWDER_PROFILE_KEY)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remember my powder label" }));
  expect(JSON.parse(localStorage.getItem(POWDER_PROFILE_KEY)!)).not.toHaveProperty("portions");
  cleanup();
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Add protein powder" }));
  expect(screen.getByLabelText("Protein powder name / flavour")).toHaveValue("Example whey");
  expect(screen.getByLabelText("Extra protein wanted per portion (g)")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Apply measured powder addition" })).toBeDisabled();
});
