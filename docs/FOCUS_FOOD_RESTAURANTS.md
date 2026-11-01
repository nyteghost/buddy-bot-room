# Focus Food: restaurant meals and shared targets

Open **Focus Food → Restaurant macros**. This is separate from recipe cooking; switching views keeps the cooking session and timer. A running-timer reminder stays visible in the restaurant view. Browser timers still cannot replace a kitchen or phone alarm for critical timing.

## Set targets once

**Your meal targets** is at the top of Focus Food, above both views. Expand **Edit meal targets / use a daily plan** to enter a meal calorie budget and protein minimum. Optional carb/fat limits are upper caps only if deliberately entered. These same targets are used for the recipe check and all restaurant comparisons. **Remember meal targets** explicitly saves them in this browser; **Forget remembered meal targets** removes the saved preference without deleting cooking progress or orders. Existing remembered meal targets and valid targets in an older cooking session are retained.

The daily-plan helper accepts a user's own daily calorie/protein targets and 1–12 meals. **Use equal-split meal budget** applies an editable starting budget: calories rounded down and protein rounded up. It does not calculate a daily requirement or account for snacks/uneven meal sizes. Daily carb/fat inputs are context only, not automatic meal caps. Daily helper inputs are not saved; the Remember button stores only the resulting meal targets. ChatGPT conversations are not connected to the running application and personal fitness targets are not embedded in repository code.

## 1. Find a meal

Search by restaurant or dish. **Search menus online** uses the existing server-configured SearXNG integration. It sends only the bounded query (not meal targets, saved orders or body data). No new subscription or API key is required. If SearXNG is unavailable, use **Open web search**, the **Official restaurant nutrition links**, or manual entry. Built-in starting links currently cover Moe's, Chipotle, Chick-fil-A, Wendy's and Panera. They are links, not a bundled nutrition database. Other restaurants can be searched or imported as well. Search results may include third parties; prefer the restaurant's own source. Search snippets never become macro values.

**Load menu nutrition** fetches a public HTTPS page through Pixel Pals' authenticated backend. The existing recipe loader validates and pins public DNS addresses and validates every redirect; localhost, private networks, credentials, custom ports and non-HTTPS URLs are refused. Extraction supports Schema.org `MenuItem` nutrition and simple labelled static HTML tables. It requires explicit units, does not infer missing facts, and leaves source serving basis unconfirmed. Imports are bounded to 100 entries and limited input size/depth. Unrelated Product/Recipe data is not treated as restaurant food.

PDF charts, JavaScript calculators, blocked sites and unsupported tables are not imported automatically. Open the source and use **Paste one menu item's nutrition**, or **Enter menu facts manually**. Paste format:

```text
Chicken bowl
Serving size: 1 bowl
Calories: 500 kcal
Protein: 40 g
Carbs: 50 g
Fat: 15 g
```

This is an example format, not a real restaurant's nutrition. Missing units or values require manual review. Paste one item only; duplicate nutrient labels are rejected rather than merged across dishes. No AI estimates or cloud inference are used.

## 2. Review and compare

Choose an imported item or enter the restaurant, exact item/custom order and serving details. Review the published facts, choose **One source serving**, enter the servings in your meal, and confirm the source. The result uses the same arithmetic as the recipe check:

- **Yes**: calories fit the meal budget, protein meets the minimum, and any explicit optional caps fit.
- **No**: one or more entered targets fail.
- **Not enough information**: facts, portion confirmation or valid targets are missing.

Include sides, sauces and drinks when comparing a complete meal. An ingredient row is not a whole meal. Changes to the item's identity, source, serving description, nutrition or portion clear confirmation. On No, the panel suggests checking published alternative orders/customizations without inventing savings or claiming a swap fits. No order is placed and the recipe is not rewritten.

## Saved orders

**Save reviewed order** stores up to 30 orders in this browser only, with source link (when supplied), last review date, serving details and reviewed nutrition. The Saved orders step searches restaurant/item names and recalculates comparisons against the currently entered shared meal targets. Values are from the last review, never presented as a fresh live menu. **Compare** loads a saved order; editing can update that order or start a new comparison. Removing an order leaves cooking, notes and other settings alone. No cross-device or Obsidian sync is added.

## Sources and limits

Official starting points checked November 1, 2026: [Moe's menu](https://www.moes.com/menu), [Chipotle calculator](https://www.chipotle.com/nutrition-calculator), [Chick-fil-A guide](https://www.chick-fil-a.com/Nutrition-Allergens), [Wendy's nutrition](https://www.wendys.com/nutrition-allergens), [Panera nutrition](https://www.panerabread.com/en-us/menu/nutritious-eating/allergen-and-nutrition-information.html). Structured fields follow [Schema.org MenuItem](https://schema.org/MenuItem). Restaurant availability, serving sizes, preparation and allergens vary; check the current source and restaurant. Macro fit is not an allergen check or a guarantee of weight loss/muscle gain.

Tests cover extraction, units, missing facts, parser limits, unsafe links, owner authentication, search-query privacy, unavailable services, cancellation, shared targets, explicit saving, saved-order comparisons, daily split validation and preservation of cooking state. Browser smoke uses controlled menu/search fixtures and checks 320/390/700-pixel layouts, private URL rejection and cooking separation. Live restaurant sites and a real SearXNG installation are not end-to-end verified by those fixtures.
