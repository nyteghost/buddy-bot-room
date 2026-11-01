import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { readMacroTargets } from "@/lib/food-macros";
import { useFoodTargets } from "@/lib/food-targets-store";
import { validRecipe, type FoodRecipe } from "@/lib/focus-food";
import {
  POWDER_PROFILE_KEY,
  emptyPowderLabel,
  powderBase,
  powderCalculation,
  powderNutrition,
  readPowderLabel,
  type PowderPlan,
} from "@/lib/protein-powder";

export function ProteinPowder({
  recipe,
  onChange,
}: {
  recipe: FoodRecipe;
  onChange: (recipe: FoodRecipe) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState<PowderPlan>({
    ...emptyPowderLabel(),
    extraProtein: "",
    portions: "",
    sourceServings: "",
    baseBasis: "unknown",
    baseConfirmed: false,
  });
  const [suitable, setSuitable] = useState(false);
  const [note, setNote] = useState("");
  const shared = useFoodTargets();
  useEffect(() => {
    try {
      const saved = readPowderLabel(JSON.parse(localStorage.getItem(POWDER_PROFILE_KEY) ?? "null"));
      if (saved) setPlan((p) => ({ ...p, ...saved }));
    } catch {
      /* Label entry works without storage. */
    }
  }, []);
  const recipeRevision = JSON.stringify([
    recipe.ingredients,
    recipe.steps,
    recipe.servings,
    recipe.nutrition,
  ]);
  useEffect(() => {
    setPlan((p) => ({ ...p, baseConfirmed: false }));
    setSuitable(false);
  }, [recipeRevision]);
  const update = (patch: Partial<PowderPlan>) => {
    setPlan({ ...plan, ...patch, baseConfirmed: false });
    setSuitable(false);
    setNote("");
  };
  const calculation = powderCalculation(plan),
    base = powderBase(recipe.nutrition, plan),
    nutrition = powderNutrition(recipe.nutrition, plan);
  const field = (key: Exclude<keyof PowderPlan, "baseBasis" | "baseConfirmed">, label: string) => (
    <label>
      {label}
      <input
        inputMode={key === "name" ? "text" : "decimal"}
        maxLength={key === "name" ? 120 : 24}
        value={plan[key]}
        onChange={(e) => update({ [key]: e.target.value })}
      />
    </label>
  );
  if (recipe.powderAddition) {
    const addition = recipe.powderAddition,
      added = powderCalculation(addition.plan)!;
    return (
      <section className="food-notice" aria-label="Added protein powder">
        <h3>Protein powder added</h3>
        <p>{addition.ingredient}</p>
        <p>
          Calculated from your reviewed label. Adds about{" "}
          {(added.added.protein / +addition.plan.portions).toFixed(1)} g protein per portion across{" "}
          {addition.plan.portions} portions.
        </p>
        <p className="food-muted">
          Instructions have not been changed. Review the mixing method, texture and suitability
          against a tested variation. After changing other ingredients or portions, recheck all
          nutrition.
        </p>
        <details>
          <summary>Original nutrition and yield before adding powder</summary>
          <p>{addition.originalServings || "Yield not provided"}</p>
          <p>{addition.originalNutrition || "Nutrition not provided"}</p>
        </details>
        <Button
          variant="outline"
          onClick={() => {
            const expected = [...addition.originalIngredients, addition.ingredient];
            const untouched =
              JSON.stringify(recipe.ingredients) === JSON.stringify(expected) &&
              recipe.servings === `${addition.plan.portions} portions` &&
              recipe.nutrition === powderNutrition(addition.originalNutrition, addition.plan);
            const ingredients = [...recipe.ingredients];
            const index = ingredients.lastIndexOf(addition.ingredient);
            if (index >= 0) ingredients.splice(index, 1);
            const { powderAddition: _removed, ...original } = recipe;
            void _removed;
            onChange({
              ...original,
              ingredients,
              servings: untouched ? addition.originalServings : recipe.servings,
              nutrition: untouched ? addition.originalNutrition : "",
            });
          }}
        >
          Remove powder addition
        </Button>
      </section>
    );
  }
  return (
    <section className="food-notice" aria-label="Protein powder calculator">
      <Button variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        Add protein powder
      </Button>
      {expanded && (
        <>
          <p>
            Choose how much extra protein you want per portion. Use the exact powder label; grams of
            powder are different from grams of protein. This calculates nutrition, not a tested
            recipe modification.
          </p>
          {field("name", "Protein powder name / flavour")}
          <div className="food-macro-grid">
            {field("grams", "Powder weight per label serving (g)")}
            {field("protein", "Protein per label serving (g)")}
            {field("calories", "Calories per label serving (kcal)")}
            {field("carbs", "Carbs per label serving (g)")}
            {field("fat", "Fat per label serving (g)")}
          </div>
          <div className="food-actions">
            <Button
              variant="outline"
              onClick={() => {
                const label = readPowderLabel(plan);
                if (!label) {
                  setNote(
                    "Enter a complete, valid powder label first. Use grams, not an assumed scoop size.",
                  );
                  return;
                }
                try {
                  localStorage.setItem(POWDER_PROFILE_KEY, JSON.stringify(label));
                  setNote(
                    "Powder label remembered in this browser. Check it again when the product changes.",
                  );
                } catch {
                  setNote("Could not remember the powder label.");
                }
              }}
            >
              Remember my powder label
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                try {
                  localStorage.removeItem(POWDER_PROFILE_KEY);
                  setNote("Remembered label removed. Current fields stay unchanged.");
                } catch {
                  setNote("Could not remove the remembered label.");
                }
              }}
            >
              Forget powder label
            </Button>
          </div>
          <div className="food-macro-grid">
            {field("portions", "Portions in the finished recipe")}
            {field("extraProtein", "Extra protein wanted per portion (g)")}
          </div>
          <details>
            <summary>Include the recipe’s existing nutrition / use my protein shortfall</summary>
            <p className="food-muted">
              Optional. Whole-recipe nutrition totals need a confirmed basis. Otherwise only the
              powder’s added nutrition can be calculated.
            </p>
            <label>
              Original nutrition describes
              <select
                value={plan.baseBasis}
                onChange={(e) => update({ baseBasis: e.target.value as PowderPlan["baseBasis"] })}
              >
                <option value="unknown">Unknown / no complete source facts</option>
                <option value="serving">One original source serving</option>
                <option value="recipe">The whole original recipe</option>
              </select>
            </label>
            {plan.baseBasis === "serving" &&
              field("sourceServings", "Source servings in the original whole recipe")}
            <p className="food-original">
              {recipe.nutrition || "No original nutrition facts found."}
            </p>
            <label className="food-check">
              <input
                type="checkbox"
                checked={plan.baseConfirmed}
                onChange={(e) => setPlan({ ...plan, baseConfirmed: e.target.checked })}
              />
              <span>
                I checked the original nutrition, serving basis and original recipe yield. No other
                ingredients have changed.
              </span>
            </label>
            <Button
              variant="outline"
              disabled={!base || !shared || !readMacroTargets(shared.targets)}
              onClick={() => {
                if (!base || !shared) return;
                const gap = +shared.targets.proteinTarget - base.protein / +plan.portions;
                if (gap <= 0) {
                  setPlan({ ...plan, extraProtein: "" });
                  setSuitable(false);
                  setNote(
                    "The original portion already meets your meal protein minimum. No powder is needed to meet that target.",
                  );
                  return;
                }
                setPlan({ ...plan, extraProtein: String(Math.ceil(gap * 100) / 100) });
                setSuitable(false);
              }}
            >
              Use my meal protein shortfall
            </Button>
          </details>
          {calculation ? (
            <div className="food-card" aria-label="Protein powder preview">
              <strong>
                Weigh {calculation.grams.toFixed(1)} g of {plan.name} for the whole recipe
              </strong>
              <p>
                About {calculation.labelServings.toFixed(2)} label servings, not scoops. Divide
                evenly into {plan.portions} portions.
              </p>
              <p>
                Powder adds to the whole recipe: {calculation.added.calories.toFixed(1)} kcal ·{" "}
                {calculation.added.protein.toFixed(1)} g protein ·{" "}
                {calculation.added.carbs.toFixed(1)} g carbs · {calculation.added.fat.toFixed(1)} g
                fat.
              </p>
              <p>
                {nutrition
                  ? `Calculated new nutrition per finished portion: ${nutrition}`
                  : "Full recipe totals remain unknown. Original source facts will be kept for reference, but will not be used as the modified recipe’s totals."}
              </p>
            </div>
          ) : (
            <p className="food-muted">
              Complete the powder label, number of portions and extra protein to see a measured
              amount.
            </p>
          )}
          <label className="food-check">
            <input
              type="checkbox"
              checked={suitable}
              onChange={(e) => setSuitable(e.target.checked)}
            />
            <span>
              I checked this product’s allergens and a suitable tested variation or mixing method. I
              will review the instructions before cooking; this calculation does not establish a
              suitable baking ratio.
            </span>
          </label>
          <Button
            disabled={!calculation || !suitable}
            onClick={() => {
              if (!calculation || !suitable) return;
              const ingredient = `${calculation.grams.toFixed(1)} g ${plan.name.trim()} (protein powder; calculated addition)`;
              const changed = validRecipe({
                ...recipe,
                ingredients: [...recipe.ingredients, ingredient],
                servings: `${plan.portions} portions`,
                nutrition,
                powderAddition: {
                  plan,
                  originalNutrition: recipe.nutrition,
                  originalServings: recipe.servings,
                  originalIngredients: [...recipe.ingredients],
                  ingredient,
                },
              });
              if (!changed || !changed.powderAddition) {
                setNote(
                  "This recipe is too large to add powder while keeping its original information. Review it manually instead.",
                );
                return;
              }
              onChange(changed);
              setExpanded(false);
            }}
          >
            Apply measured powder addition
          </Button>
          {note && <p role="status">{note}</p>}
        </>
      )}
    </section>
  );
}
