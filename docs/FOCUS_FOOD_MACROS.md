# Focus Food: finished-recipe nutrition and macro check

After marking the last cooking step complete, Focus Food displays **Nutrition facts & Macro Check**. This stays separate from cooking instructions and Pal animations. The original recipe and serving yield are not changed.

## Review once, then see the result

Open **Review nutrition, portion and meal targets**. Explicit source values such as `calories: 500 kcal`, `proteinContent: 40 g`, `carbohydrateContent: 50 g`, and `fatContent: 15 g` prefill the fields from the recipe's existing nutrition text. It never estimates nutrition from ingredients or asks a model to invent values. Unrecognized units, inequalities, ranges, missing units and unsupported layouts remain blank for manual review. Recipe imports still depend on the source site's recipe data and access permissions.

Confirm whether those facts describe one source serving or the whole recipe. For whole-recipe values, enter the number of equal portions you made. Enter how many source servings or recipe portions are in your meal. Check the confirmation box only after reviewing the source, actual products and any ingredient changes. Editing facts, their basis or portion size clears that confirmation.

Set your **meal calorie budget** and **meal protein minimum** in **Your meal targets** at the top of Focus Food. These are shared by recipe and restaurant comparisons. Optional carb and fat limits are used only when explicitly entered; there are no automatic low-carb/low-fat rules, daily calorie prescriptions or muscle-gain promises. Targets are blank initially. **Remember meal targets** explicitly stores only the targets for future recipes in this browser. **Forget remembered meal targets** removes that preference without clearing this meal's entered facts or cooking progress.

## Exactly what Yes and No mean

- **Yes — fits your meal targets**: the confirmed meal portion's calories are at or below your budget, protein is at or above your minimum, and any optional carb/fat caps are met.
- **No — doesn’t fit your meal targets**: at least one of those explicit checks fails. The screen lists which conditions failed.
- **Not enough information to judge**: facts, serving basis, confirmation or valid targets are missing. Missing nutrients are not treated as zero. There is no forced Yes/No when a comparison cannot be made.

Whole-recipe values are divided by equal portions, then multiplied by portions in the meal. Per-source-serving values are multiplied by the source servings eaten. The nutrition facts panel shows calories, protein, carbs and fat for that meal portion. Comparisons use unrounded values; display values are rounded for readability. Source nutrition itself may be estimated or rounded and is not a lab analysis of the prepared food.

These are transparent user-selected target checks, not a universal judgment about whether food is healthy or a prediction that one meal will cause weight loss or muscle gain. The full day's intake, training and consistency matter. The FDA explains that nutrition values must be interpreted with serving size and that calorie needs differ between people: [label guidance](https://www.fda.gov/food/nutrition-facts-label/how-understand-and-use-nutrition-facts-label), [serving size](https://www.fda.gov/food/nutrition-facts-label/serving-size-nutrition-facts-label). Source field names follow [Schema.org NutritionInformation](https://schema.org/NutritionInformation).

## Ingredient alternatives after a No

Offline rules compare the actual ingredient names with the failing targets. Examples include plain unsweetened Greek yogurt to compare with mayonnaise/sour cream in a cold dressing or topping, leaner versions of the same ground meat, bean/lentil pasta for a protein comparison, suitable vegetable alternatives to part of rice/pasta for a chosen carb cap, and reduced-fat versions of cheese. These are suggestions to compare, never calculated claims that the revised recipe will pass. If no rule matches confidently, the screen says so and offers a general comparison idea.

Check matching serving sizes, labels, allergens, taste and whether the substitution suits the recipe. Cooking, texture and timing may change; use a tested variation or the new product's instructions. No ingredients, quantities, cooking temperatures or timers are changed automatically. **I changed ingredients — recheck nutrition** clears the nutrition confirmation; update the values and confirm again before relying on the result. A new Yes is never manufactured by subtracting guessed calories or adding guessed protein.

## Storage and validation

The optional `macroCheck` belongs to the existing browser-local cooking session, preserving prior sessions without a migration. Invalid macro state is discarded without discarding recipe/progress/timer data. Remembered meal targets have their own versioned browser key. No nutrition, targets, body measurements or medical history are sent to any API, AI, mailbox or Obsidian vault by this feature.

Tests cover strict source parsing, missing vs zero values, whole-recipe/per-serving math, confirmation, numeric bounds, explicit optional limits, Yes/No reasons, ingredient-specific suggestions, remembered-target deletion, old-session recovery and malformed macro data. Browser smoke completes a recipe, checks No with an ingredient alternative, updates targets to Yes, reloads and checks recovery while verifying the original ingredients/instructions remain intact. Mobile widths remain 320/390/700 pixels. Real recipe labels and prepared-food portions still require user review.
