import { describe, expect, it } from "vitest";
import { foodCoach, newFoodSession, pastedRecipe, readFoodSession, recipeUrl, validRecipe } from "@/lib/focus-food";
import { extractRecipe, publicRecipeAddress } from "@/lib/recipe-import.server";
const recipe = { title: "Rice", ingredients: ["1 cup rice", "2 cups water"], steps: ["Bring water to a boil. Cover and simmer 18 minutes.", "Rest for 5 minutes."], servings: "2 servings", source: "", nutrition: "" };
describe("Focus Food source preservation", () => {
  it("imports graph, section and HowToStep JSON-LD without rewriting safety values", () => {
    const data = { "@graph": [{ "@type": "Recipe", name: "Rice &amp; beans", recipeIngredient: recipe.ingredients, recipeInstructions: [{ "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "Bake at 180°C for 25 minutes; check doneness." }] }], recipeYield: "4 servings", nutrition: { "@type": "NutritionInformation", calories: "400 calories" } }] };
    const result = extractRecipe(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, "https://recipes.example.com/rice");
    expect(result).toMatchObject({ title: "Rice & beans", steps: ["Bake at 180°C for 25 minutes; check doneness."], servings: "4 servings", nutrition: "calories: 400 calories" });
  });
  it("skips malformed schema and refuses incomplete or oversized instructions", () => {
    expect(extractRecipe('<script type="application/ld+json">{broken}</script>', "https://example.com")).toBeNull();
    expect(validRecipe({ ...recipe, steps: ["x".repeat(6001)] })).toBeNull();
    expect(validRecipe({ ...recipe, ingredients: [] })).toBeNull();
  });
  it("pasted text keeps punctuation, temperatures and times together", () => {
    const result = pastedRecipe("Rice\nIngredients\n1 cup rice\nInstructions\nBake at 180°C. Check after 25 minutes.\nRest 5 minutes.");
    expect(result?.steps).toEqual(["Bake at 180°C. Check after 25 minutes.", "Rest 5 minutes."]);
    expect(pastedRecipe("Some blog post without recipe sections")).toBeNull();
  });
  it("recovers bounded progress and a running deadline without altering the recipe", () => {
    const s = { ...newFoodSession(recipe), stage: "cook", index: 1, timer: { label: "Rice", end: 12345678 } };
    expect(readFoodSession(JSON.stringify(s))).toEqual(s);
    expect(readFoodSession(JSON.stringify({ ...s, index: 9 }))).toBeNull();
    expect(readFoodSession(JSON.stringify({ ...s, checked: [999] }))).toBeNull();
    expect(readFoodSession(JSON.stringify({ ...s, timer: { label: "Rice", end: "soon" } }))).toBeNull();
    expect(foodCoach(recipe.steps[0]!)).toContain(recipe.steps[0]);
  });
  it.each(["http://example.com", "https://user:pass@example.com", "https://127.1", "https://0x7f000001", "https://[::1]", "https://tower.local", "https://example.com:8090"])("rejects non-public URL form %s", url => expect(recipeUrl(url)).toBeNull());
  it.each(["127.0.0.1", "10.200.1.30", "172.17.0.1", "192.168.0.1", "169.254.169.254", "100.108.59.76", "0.0.0.0", "224.0.0.1", "198.18.1.1", "::1", "::ffff:127.0.0.1"])("blocks internal and special address %s", ip => expect(publicRecipeAddress(ip)).toBe(false));
  it("allows a normal public IPv4 address and HTTPS hostname", () => { expect(publicRecipeAddress("93.184.216.34")).toBe(true); expect(recipeUrl("https://example.com/recipe#ingredients")?.hash).toBe(""); });
});
