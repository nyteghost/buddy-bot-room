import { expect, it } from "vitest";
import { foodPalAction } from "@/lib/food-pal";
import { newFoodSession } from "@/lib/focus-food";
const base = newFoodSession({ title: "Recipe", ingredients: ["Ingredients"], steps: ["Mix, then simmer for 10 minutes."], servings: "", source: "", nutrition: "" });
it.each([["Chop the vegetables.", "chop"], ["Whisk the mixture.", "mix"], ["Preheat the oven.", "heat"], ["Simmer 18 minutes.", "heat"], ["Rest for 5 minutes.", "wait"], ["Portion into containers.", "plate"], ["Read the recipe.", "gather"]])("chooses a visual for %s without editing instructions", (text, action) => {
  const session = { ...base, stage: "cook" as const, recipe: { ...base.recipe, steps: [text!] } };
  const before = JSON.stringify(session);
  expect(foodPalAction(session, false)).toBe(action);
  expect(JSON.stringify(session)).toBe(before);
});
it("follows the first action, and only explicit progress controls the scene", () => {
  expect(foodPalAction(base, false)).toBe("gather");
  expect(foodPalAction({ ...base, stage: "cook", timer: { label: "Expired", end: 0 } }, false)).toBe("mix");
  expect(foodPalAction({ ...base, stage: "cook" }, true)).toBe("rest");
  expect(foodPalAction({ ...base, stage: "done" }, false)).toBe("celebrate");
});
