import { recipeUrl } from "./focus-food";
import { initialFoodMacros, readFoodMacros, type FoodMacros } from "./food-macros";

export const RESTAURANT_FOOD_KEY = "pixel-pals-restaurant-orders-v1";
/** Official starting points, not a bundled or supposedly current nutrition database. */
export const RESTAURANTS = [
  { name: "Moe’s Southwest Grill", url: "https://www.moes.com/menu" },
  { name: "Chipotle", url: "https://www.chipotle.com/nutrition-calculator" },
  { name: "Chick-fil-A", url: "https://www.chick-fil-a.com/Nutrition-Allergens" },
  { name: "Wendy’s", url: "https://www.wendys.com/nutrition-allergens" },
  {
    name: "Panera Bread",
    url: "https://www.panerabread.com/en-us/menu/nutritious-eating/allergen-and-nutrition-information.html",
  },
];
export type MenuFood = { name: string; serving: string; nutrition: string; source: string };
export type RestaurantOrder = {
  id: string;
  restaurant: string;
  name: string;
  serving: string;
  source: string;
  checkedAt: string;
  macros: FoodMacros;
};
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
export function validMenuFood(v: unknown): MenuFood | null {
  if (!v || typeof v !== "object") return null;
  const o = v as MenuFood;
  if (
    !text(o.name, 240) ||
    !o.name.trim() ||
    !text(o.serving, 240) ||
    !text(o.nutrition, 2000) ||
    !text(o.source, 2000) ||
    (o.source && !recipeUrl(o.source))
  )
    return null;
  return { name: o.name.trim(), serving: o.serving, nutrition: o.nutrition, source: o.source };
}
export function readRestaurantOrders(raw: string | null): RestaurantOrder[] {
  if (!raw || raw.length > 150000) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length > 30) return [];
    const ids = new Set<string>();
    return data.flatMap((o: RestaurantOrder) => {
      if (
        !o ||
        !text(o.id, 80) ||
        !/^[\w-]+$/.test(o.id) ||
        ids.has(o.id) ||
        !text(o.restaurant, 160) ||
        !o.restaurant.trim() ||
        !text(o.checkedAt, 40) ||
        !Number.isFinite(Date.parse(o.checkedAt))
      )
        return [];
      const item = validMenuFood({ ...o, nutrition: "" }),
        macros = readFoodMacros(o.macros);
      if (!item || !macros || macros.basis !== "serving") return [];
      ids.add(o.id);
      return [
        {
          id: o.id,
          restaurant: o.restaurant,
          name: item.name,
          serving: item.serving,
          source: item.source,
          checkedAt: o.checkedAt,
          macros,
        },
      ];
    });
  } catch {
    return [];
  }
}
export function restaurantMatches(value: string, query: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return normalize(query)
    .split(/\s+/)
    .every((q) => normalize(value).includes(q));
}
/** Only single-item, explicitly labelled quantities; never join facts from multiple items. */
export function pastedMenuFood(raw: string): MenuFood | null {
  if (!raw.trim() || raw.length > 24000) return null;
  const lines = raw
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const name = lines[0] ?? "";
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const m =
      /^(calories|protein|total fat|fat|total carbohydrates|carbohydrates|carbs|serving size)\s*(?:\((kcal|g)\))?\s*:\s*(.+)$/i.exec(
        line,
      );
    if (!m) continue;
    const label = m[1]!.toLowerCase();
    const key = /carbo|carbs/.test(label) ? "carbs" : /fat/.test(label) ? "fat" : label;
    if (fields.has(key)) return null;
    fields.set(key, `${m[3]}${m[2] ? ` ${m[2]}` : ""}`);
  }
  const nutrition = ["calories", "protein", "carbs", "fat"]
    .filter((k) => fields.has(k))
    .map((k) => `${k}: ${fields.get(k)}`)
    .join(" · ");
  const macros = initialFoodMacros(nutrition);
  if (![macros.calories, macros.protein, macros.carbs, macros.fat].some(Boolean)) return null;
  return validMenuFood({ name, serving: fields.get("serving size") ?? "", nutrition, source: "" });
}
