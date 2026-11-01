import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
  FOOD_MACRO_TARGETS_KEY,
  checkFoodMacros,
  initialFoodMacros,
  macroAlternatives,
  readMacroTargets,
  type FoodMacros as MacroData,
} from "@/lib/food-macros";
import type { FoodRecipe } from "@/lib/focus-food";
export function FoodMacroCheck({
  recipe,
  value,
  onChange,
}: {
  recipe: FoodRecipe;
  value?: MacroData | undefined;
  onChange: (value: MacroData) => void;
}) {
  const data = value ?? initialFoodMacros(recipe.nutrition),
    result = checkFoodMacros(data);
  const loaded = useRef(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    if (value) return;
    try {
      const targets = readMacroTargets(
        JSON.parse(localStorage.getItem(FOOD_MACRO_TARGETS_KEY) ?? "null"),
      );
      if (targets) onChange({ ...initialFoodMacros(recipe.nutrition), ...targets });
    } catch {
      /* Optional remembered targets. */
    }
  }, [value, recipe.nutrition, onChange]);
  const edit = (patch: Partial<MacroData>, facts = false) =>
    onChange({ ...data, ...patch, ...(facts ? { confirmed: false } : {}) });
  const input = (
    key:
      | "calories"
      | "protein"
      | "carbs"
      | "fat"
      | "calorieLimit"
      | "proteinTarget"
      | "carbLimit"
      | "fatLimit"
      | "amount"
      | "servings",
    label: string,
    facts = false,
  ) => (
    <label>
      {label}
      <input
        type="text"
        inputMode="decimal"
        maxLength={24}
        value={data[key]}
        onChange={(e) => edit({ [key]: e.target.value }, facts)}
      />
    </label>
  );
  const n = (v: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(v);
  return (
    <section
      className="food-card food-macro-check"
      aria-label="Finished recipe nutrition and macro check"
    >
      <h3>Nutrition facts &amp; Macro Check</h3>
      <p>
        Check this portion against your own weight-loss / muscle-building meal plan. This is a
        calorie-and-protein target check, not a guarantee of fat loss, muscle gain or overall diet
        quality.
      </p>
      {recipe.nutrition ? (
        <p className="food-muted food-original">
          Recipe-provided facts (serving basis unverified): {recipe.nutrition}
        </p>
      ) : (
        <p className="food-muted">
          No source nutrition was found. Enter facts from the recipe or product labels; AI will not
          estimate them from the ingredient list.
        </p>
      )}
      {recipe.source && (
        <a href={recipe.source} target="_blank" rel="noopener noreferrer">
          Check the original recipe nutrition
        </a>
      )}
      <details>
        <summary>Review nutrition, portion and meal targets</summary>
        <div className="grid min-w-0 gap-3">
          <div className="food-macro-grid">
            {input("calories", "Source calories (kcal)", true)}
            {input("protein", "Source protein (g)", true)}
            {input("carbs", "Source carbs (g)", true)}
            {input("fat", "Source fat (g)", true)}
          </div>
          <label>
            Those source facts describe
            <select
              aria-label="Nutrition serving basis"
              value={data.basis}
              onChange={(e) => edit({ basis: e.target.value as MacroData["basis"] }, true)}
            >
              <option value="unknown">Choose the basis after checking the source</option>
              <option value="serving">One source serving</option>
              <option value="recipe">The whole recipe</option>
            </select>
          </label>
          {data.basis === "recipe" &&
            input("servings", "Equal portions made from the whole recipe", true)}
          {input(
            "amount",
            data.basis === "recipe"
              ? "Recipe portions in your meal"
              : "Source servings in your meal",
            true,
          )}
          <label className="food-check">
            <input
              type="checkbox"
              checked={data.confirmed}
              onChange={(e) => edit({ confirmed: e.target.checked })}
            />
            <span>
              I checked these facts and the serving basis against my source, including any
              ingredient changes.
            </span>
          </label>
          <h3>Your targets for this meal</h3>
          <p className="food-muted">
            Choose these from your own daily plan. Pixel Pals does not prescribe a daily calorie
            deficit or protein requirement, and does not assume 2,000 calories fits everyone.
          </p>
          <div className="food-macro-grid">
            {input("calorieLimit", "Meal calorie budget (kcal)")}
            {input("proteinTarget", "Meal protein minimum (g)")}
            {input("carbLimit", "Meal carb limit (g, optional)")}
            {input("fatLimit", "Meal fat limit (g, optional)")}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const targets = readMacroTargets(data);
              if (!targets) {
                setNote("Enter valid meal targets first.");
                return;
              }
              try {
                localStorage.setItem(FOOD_MACRO_TARGETS_KEY, JSON.stringify(targets));
                setNote(
                  "Meal targets remembered in this browser. Recipe nutrition stays separate.",
                );
              } catch {
                setNote("Targets could not be saved in this browser.");
              }
            }}
          >
            Remember meal targets
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              try {
                localStorage.removeItem(FOOD_MACRO_TARGETS_KEY);
                setNote("Remembered targets removed. This meal’s entered values stay unchanged.");
              } catch {
                setNote("Remembered targets could not be removed in this browser.");
              }
            }}
          >
            Forget remembered meal targets
          </Button>
          {note && (
            <p role="status" className="food-muted">
              {note}
            </p>
          )}
        </div>
      </details>
      {result.portion && (
        <div className="food-nutrition-facts" aria-label="Nutrition for your meal portion">
          <strong>Your meal portion</strong>
          <dl>
            <div>
              <dt>Calories</dt>
              <dd>{n(result.portion.calories)} kcal</dd>
            </div>
            <div>
              <dt>Protein</dt>
              <dd>{n(result.portion.protein)} g</dd>
            </div>
            <div>
              <dt>Carbs</dt>
              <dd>{n(result.portion.carbs)} g</dd>
            </div>
            <div>
              <dt>Fat</dt>
              <dd>{n(result.portion.fat)} g</dd>
            </div>
          </dl>
          <small>Calculated from your confirmed source values; not a lab analysis.</small>
        </div>
      )}
      <div className="food-notice" role="status" data-macro-verdict={result.verdict}>
        <strong>
          {result.verdict === "yes"
            ? "Yes — fits your meal targets"
            : result.verdict === "no"
              ? "No — doesn’t fit your meal targets"
              : "Not enough information to judge"}
        </strong>
        <ul>
          {result.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="food-muted">
          The full day’s intake, training and consistency matter. A No does not mean the food is
          bad; carbs and fat have no automatic pass/fail limits unless you set them.
        </p>
      </div>
      {result.verdict === "no" && (
        <div className="grid gap-2" aria-label="Ingredient alternatives to review">
          <h3>Ingredient alternatives to consider</h3>
          {macroAlternatives(recipe.ingredients, result).map((x) => (
            <div key={x.ingredient} className="food-notice">
              <strong>{x.ingredient}</strong>
              <p>{x.suggestion}</p>
            </div>
          ))}
          <p className="food-muted">
            Suggestions only. Compare matching portions and check allergies and dietary needs. They
            do not rewrite your recipe or prove better macros. After any change, update the
            nutrition and confirm again before relying on the result.
          </p>
          <Button type="button" variant="outline" onClick={() => edit({ confirmed: false })}>
            I changed ingredients — recheck nutrition
          </Button>
        </div>
      )}
      <details>
        <summary>How the check works</summary>
        <p>
          Yes means this portion is within your calorie budget, meets your protein minimum, and
          stays within any carb/fat limits you entered. It uses arithmetic, not an AI judgment.
          Missing facts, an unknown serving basis, or missing targets prevent a Yes or No.
        </p>
        <a
          href="https://www.fda.gov/food/nutrition-facts-label/how-understand-and-use-nutrition-facts-label"
          target="_blank"
          rel="noopener noreferrer"
        >
          FDA: understanding nutrition labels and serving sizes
        </a>
      </details>
    </section>
  );
}
