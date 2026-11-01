import { useEffect, useState, type ReactNode } from "react";
import { FOOD_KEY, readFoodSession } from "@/lib/focus-food";
import { Button } from "./ui/button";
import {
  FOOD_MACRO_TARGETS_KEY,
  initialFoodMacros,
  readMacroTargets,
  type MacroTargets,
} from "@/lib/food-macros";

import { FoodTargetsContext, useFoodTargets } from "@/lib/food-targets-store";
export function FoodTargetsProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<MacroTargets>(() => {
    const { calorieLimit, proteinTarget, carbLimit, fatLimit } = initialFoodMacros("");
    return { calorieLimit, proteinTarget, carbLimit, fatLimit };
  });
  useEffect(() => {
    try {
      const saved = readMacroTargets(
        JSON.parse(localStorage.getItem(FOOD_MACRO_TARGETS_KEY) ?? "null"),
      );
      const legacy = readMacroTargets(readFoodSession(localStorage.getItem(FOOD_KEY))?.macroCheck);
      if (saved || legacy) setTargets((saved ?? legacy)!);
    } catch {
      /* Manual targets remain available. */
    }
  }, []);
  return (
    <FoodTargetsContext.Provider value={{ targets, setTargets }}>
      {children}
    </FoodTargetsContext.Provider>
  );
}
export function FoodTargetsPanel() {
  const shared = useFoodTargets()!;
  const [note, setNote] = useState("");
  const [daily, setDaily] = useState({ calories: "", protein: "", carbs: "", fat: "", meals: "3" });
  const valid = readMacroTargets(shared.targets);
  const field = (key: keyof MacroTargets, label: string) => (
    <label>
      {label}
      <input
        inputMode="decimal"
        maxLength={24}
        value={shared.targets[key]}
        onChange={(e) => shared.setTargets({ ...shared.targets, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <section className="food-card food-targets" aria-label="Shared meal targets">
      <h3>Your meal targets</h3>
      <p>
        {valid
          ? `${valid.calorieLimit} kcal budget · at least ${valid.proteinTarget} g protein`
          : "Set your calorie budget and protein minimum to get a Yes / No."}
      </p>
      <p className="food-muted">
        Used by both recipe and restaurant checks. These describe one meal, not your whole day.
        Carbs and fat are optional upper limits, not required amounts.
      </p>
      <details>
        <summary>Edit meal targets / use a daily plan</summary>
        <div className="food-macro-grid">
          {field("calorieLimit", "Meal calorie budget (kcal)")}
          {field("proteinTarget", "Meal protein minimum (g)")}
          {field("carbLimit", "Meal carb limit (g, optional)")}
          {field("fatLimit", "Meal fat limit (g, optional)")}
        </div>
        <details>
          <summary>Divide my own daily plan into meals</summary>
          <p className="food-muted">
            Enter targets you already chose. An equal split is just a starting meal budget; adjust
            it for snacks or differently sized meals. Daily carb/fat goals do not become pass/fail
            caps automatically.
          </p>
          <div className="food-macro-grid">
            {(
              [
                ["calories", "Daily calorie target (kcal)"],
                ["protein", "Daily protein target (g)"],
                ["carbs", "Daily carb target (g, optional)"],
                ["fat", "Daily fat target (g, optional)"],
                ["meals", "Meals to divide across"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  inputMode="decimal"
                  maxLength={24}
                  value={daily[key]}
                  onChange={(e) => setDaily({ ...daily, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              const positive = (s: string, max: number) =>
                /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s) && +s > 0 && +s <= max;
              if (
                !positive(daily.calories, 20000) ||
                !positive(daily.protein, 1000) ||
                !/^(?:[1-9]|1[0-2])$/.test(daily.meals) ||
                (daily.carbs && !positive(daily.carbs, 3000)) ||
                (daily.fat && !positive(daily.fat, 2000))
              ) {
                setNote(
                  "Enter a valid daily calorie/protein plan and 1–12 meals. Optional carb/fat targets must be positive if entered.",
                );
                return;
              }
              const meals = +daily.meals;
              shared.setTargets({
                ...shared.targets,
                calorieLimit: String(Math.floor(+daily.calories / meals)),
                proteinTarget: String(Math.ceil(+daily.protein / meals)),
              });
              setNote(
                `Equal-split starting budget applied for ${meals} meals. Adjust for snacks and meal sizes. ${daily.carbs ? `Your daily carb goal: ${daily.carbs} g. ` : ""}${daily.fat ? `Your daily fat goal: ${daily.fat} g. ` : ""}Optional meal carb/fat limits stay unchanged. Remember targets to keep the meal budget after a reload.`,
              );
            }}
          >
            Use equal-split meal budget
          </Button>
        </details>
        <div className="food-actions">
          <Button
            variant="outline"
            disabled={!valid}
            onClick={() => {
              try {
                localStorage.setItem(FOOD_MACRO_TARGETS_KEY, JSON.stringify(valid));
                setNote("Meal targets remembered for recipes and restaurants in this browser.");
              } catch {
                setNote("Could not remember targets in this browser.");
              }
            }}
          >
            Remember meal targets
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              try {
                localStorage.removeItem(FOOD_MACRO_TARGETS_KEY);
                setNote(
                  "Remembered targets removed. Your current meal budget stays available until reload.",
                );
              } catch {
                setNote("Could not remove remembered targets.");
              }
            }}
          >
            Forget remembered meal targets
          </Button>
        </div>
      </details>
      {note && (
        <p role="status" className="food-notice">
          {note}
        </p>
      )}
    </section>
  );
}
