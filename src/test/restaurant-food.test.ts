import { expect, it } from "vitest";
import {
  pastedMenuFood,
  readRestaurantOrders,
  restaurantMatches,
  RESTAURANTS,
} from "@/lib/restaurant-food";
import { extractMenuFoods } from "@/lib/restaurant-import.server";
import { checkFoodMacros, initialFoodMacros } from "@/lib/food-macros";

const nutrition =
  "calories: 500 kcal · proteinContent: 40 g · carbohydrateContent: 50 g · fatContent: 15 g";
const script = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const item = {
  "@type": "MenuItem",
  name: "Chicken bowl",
  nutrition: {
    calories: "500 kcal",
    proteinContent: "40 g",
    carbohydrateContent: "50 g",
    fatContent: "15 g",
    servingSize: "1 bowl",
  },
};
const source = "https://restaurant.example/menu";
it("imports nested MenuItems with exact labels and no invented serving basis", () => {
  const foods = extractMenuFoods(
    script({ "@type": "Menu", hasMenuSection: { hasMenuItem: [item, item] } }),
    source,
  );
  expect(foods).toEqual([{ name: "Chicken bowl", serving: "1 bowl", nutrition, source }]);
  expect(initialFoodMacros(foods[0]!.nutrition)).toMatchObject({
    calories: "500",
    protein: "40",
    basis: "unknown",
    confirmed: false,
  });
});
it("does not turn unrelated Product or Recipe facts into restaurant menu items", () => {
  expect(
    extractMenuFoods(
      script({ ...item, "@type": "Product" }) + script({ ...item, "@type": "Recipe" }),
      source,
    ),
  ).toEqual([]);
});
it("ignores broken blocks, rejects nonpublic source URLs and bounds recursive inputs", () => {
  expect(
    extractMenuFoods('<script type="application/ld+json">broken</script>' + script(item), source),
  ).toHaveLength(1);
  expect(extractMenuFoods(script(item), "javascript:alert(1)")).toEqual([]);
  expect(extractMenuFoods("x".repeat(1500001), source)).toEqual([]);
  let deep: unknown = item;
  for (let i = 0; i < 20; i++) deep = [deep];
  expect(extractMenuFoods(script(deep), source)).toEqual([]);
});
it("leaves missing units and missing nutrients unknown, not zero", () => {
  const foods = extractMenuFoods(
    script({ ...item, nutrition: { calories: 500, proteinContent: "40 g" } }),
    source,
  );
  expect(initialFoodMacros(foods[0]!.nutrition)).toMatchObject({
    calories: "",
    protein: "40",
    carbs: "",
    fat: "",
  });
});
it("reads explicitly labelled static HTML tables and ignores saturated fat and calories from fat", () => {
  const html =
    "<table><tr><th>Item</th><th>Serving Size</th><th>Calories</th><th>Calories from Fat</th><th>Total Fat (g)</th><th>Saturated Fat (g)</th><th>Carbohydrates (g)</th><th>Protein (g)</th></tr><tr><td>Chicken &amp; rice</td><td>1 bowl</td><td>500</td><td>135</td><td>15</td><td>3</td><td>50</td><td>40</td></tr></table>";
  expect(extractMenuFoods(html, source)).toEqual([
    {
      name: "Chicken & rice",
      serving: "1 bowl",
      nutrition: "calories: 500 kcal · fat: 15 g · carbs: 50 g · protein: 40 g",
      source,
    },
  ]);
});
it("never guesses unlabelled, merged, unit-ambiguous or ranged table columns", () => {
  expect(
    extractMenuFoods(
      "<table><tr><th>Item</th><th>Protein</th></tr><tr><td>Bowl</td><td>40</td></tr></table>",
      source,
    ),
  ).toEqual([]);
  expect(
    extractMenuFoods(
      '<table><tr><th>Item</th><th>Calories</th></tr><tr><td colspan="2">Bowl 500</td></tr></table>',
      source,
    ),
  ).toEqual([]);
  expect(
    extractMenuFoods(
      "<table><tr><th>Item</th><th>Calories</th></tr><tr><td>Bowl</td><td>400–600</td></tr></table>",
      source,
    ),
  ).toEqual([]);
});
it("pastes single-item labelled facts and retains missing values for manual review", () => {
  const food = pastedMenuFood(
    "Bowl\nServing size: 1 bowl\nCalories: 500 kcal\nProtein (g): 40\nCarbs: 50 g\nTotal fat: 15 g",
  );
  expect(food).toMatchObject({ name: "Bowl", serving: "1 bowl" });
  expect(initialFoodMacros(food!.nutrition)).toMatchObject({
    calories: "500",
    protein: "40",
    carbs: "50",
    fat: "15",
    confirmed: false,
  });
  expect(pastedMenuFood("Bowl\nCalories: 500\nProtein: 40")).toBeNull();
  expect(pastedMenuFood("Bowl\nCalories: 500 kcal\nBurger\nCalories: 700 kcal")).toBeNull();
});
it("validates saved orders individually without losing good entries or accepting unsafe links", () => {
  const order = {
    id: "order-1",
    restaurant: "Example",
    name: "Bowl",
    serving: "1 bowl",
    source,
    checkedAt: "2026-11-01T15:00:00Z",
    macros: {
      ...initialFoodMacros(nutrition),
      basis: "serving",
      confirmed: true,
      calorieLimit: "600",
      proteinTarget: "35",
    },
  };
  expect(
    readRestaurantOrders(
      JSON.stringify([order, { ...order, id: "bad", source: "http://10.200.1.30" }, order]),
    ),
  ).toEqual([order]);
  expect(checkFoodMacros(readRestaurantOrders(JSON.stringify([order]))[0]!.macros).verdict).toBe(
    "yes",
  );
  expect(readRestaurantOrders("{}")).toEqual([]);
  expect(readRestaurantOrders(JSON.stringify(Array(31).fill(order)))).toEqual([]);
});
it("matches restaurant and meal words without depending on punctuation", () => {
  expect(restaurantMatches("Moe’s Southwest Grill Chicken Bowl", "moes bowl")).toBe(true);
  expect(restaurantMatches("Moe’s Southwest Grill Chicken Bowl", "Moe’s bowl")).toBe(true);
  expect(restaurantMatches("Chipotle bowl", "chipotle chicken")).toBe(false);
  expect(RESTAURANTS.every((r) => r.url.startsWith("https://"))).toBe(true);
});
