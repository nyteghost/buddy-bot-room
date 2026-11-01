import { useFoodTargets } from "@/lib/food-targets-store";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { FoodMacroCheck } from "./food-macros";
import {
  FOOD_MACRO_TARGETS_KEY,
  checkFoodMacros,
  initialFoodMacros,
  portionMacros,
  readMacroTargets,
  type FoodMacros,
} from "@/lib/food-macros";
import { recipeUrl } from "@/lib/focus-food";
import {
  RESTAURANTS,
  RESTAURANT_FOOD_KEY,
  pastedMenuFood,
  readRestaurantOrders,
  restaurantMatches,
  validMenuFood,
  type MenuFood,
  type RestaurantOrder,
} from "@/lib/restaurant-food";
import type { SearchHit } from "@/lib/search";

const blank = { restaurant: "", name: "", serving: "", source: "" };
export function RestaurantFood({ open }: { open: boolean }) {
  const shared = useFoodTargets();
  const [stage, setStage] = useState<"find" | "review" | "saved">("find");
  const [savedQuery, setSavedQuery] = useState("");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [menu, setMenu] = useState<MenuFood[]>([]);
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [draft, setDraft] = useState(blank);
  const [macros, setMacros] = useState<FoodMacros>(initialFoodMacros(""));
  const [sourceFacts, setSourceFacts] = useState("");
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState("");
  const pending = useRef<AbortController | null>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  };
  useEffect(() => {
    try {
      setOrders(readRestaurantOrders(localStorage.getItem(RESTAURANT_FOOD_KEY)));
      const targets = readMacroTargets(
        JSON.parse(localStorage.getItem(FOOD_MACRO_TARGETS_KEY) ?? "null"),
      );
      if (targets) setMacros({ ...initialFoodMacros(""), ...targets });
    } catch {
      setNote("Browser storage is unavailable. You can compare an order, but saving may not work.");
    }
    setReady(true);
    return () => pending.current?.abort();
  }, []);
  useEffect(() => {
    if (!open) {
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
    }
  }, [open]);
  const targets = () =>
    shared?.targets ?? {
      calorieLimit: macros.calorieLimit,
      proteinTarget: macros.proteinTarget,
      carbLimit: macros.carbLimit,
      fatLimit: macros.fatLimit,
    };
  const choose = (item: MenuFood) => {
    setDraft({ ...draft, name: item.name, serving: item.serving, source: item.source });
    setSourceFacts(item.nutrition);
    setMacros({ ...initialFoodMacros(item.nutrition), ...targets() });
    setEditingId("");
    setNote(
      "Review this exact item, size and customizations against the source before confirming.",
    );
    setStage("review");
  };
  const lookup = async (body: Record<string, string>) => {
    cancel();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNote("");
    try {
      const response = await fetch("/api/focus-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      if (controller.signal.aborted || pending.current !== controller) return;
      if (!response.ok) {
        setNote(
          typeof data.error === "string"
            ? data.error
            : "Lookup unavailable. Manual entry still works.",
        );
        return;
      }
      if (body["op"] === "restaurant-search") {
        const found = Array.isArray(data.hits)
          ? data.hits
              .filter(
                (h: SearchHit) =>
                  h && typeof h.title === "string" && typeof h.url === "string" && recipeUrl(h.url),
              )
              .slice(0, 6)
          : [];
        setHits(found);
        setNote(
          found.length
            ? "Search results are links, not verified nutrition. Prefer the restaurant’s own website."
            : "No web results. Try an official link or enter an item manually.",
        );
      } else {
        const items: MenuFood[] = Array.isArray(data.items)
          ? data.items
              .slice(0, 100)
              .map(validMenuFood)
              .filter((i: MenuFood | null): i is MenuFood => !!i)
          : [];
        setMenu(items);
        setFilter("");
        setNote(
          items.length
            ? "Menu data loaded. Choose an item to review its facts; imported values are not verified."
            : "No readable menu facts. Paste one item or enter manually.",
        );
      }
    } catch {
      if (!controller.signal.aborted)
        setNote(
          "Restaurant lookup is unavailable. Saved orders and manual comparison still work offline.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  const saveOrders = (next: RestaurantOrder[], message: string) => {
    try {
      localStorage.setItem(RESTAURANT_FOOD_KEY, JSON.stringify(next));
      setOrders(next);
      setNote(message);
      return true;
    } catch {
      setNote("Could not save in this browser. Existing saved orders have not been changed.");
      return false;
    }
  };
  const save = () => {
    if (
      !draft.restaurant.trim() ||
      !draft.name.trim() ||
      !portionMacros(macros) ||
      macros.basis !== "serving" ||
      (draft.source && !recipeUrl(draft.source))
    ) {
      setNote(
        "Add the restaurant and item name, a public HTTPS source if used, then review and confirm all per-serving facts.",
      );
      return;
    }
    if (!editingId && orders.length >= 30) {
      setNote("You have 30 saved orders. Remove one before saving another.");
      return;
    }
    const id = editingId || crypto.randomUUID();
    const order: RestaurantOrder = {
      ...draft,
      restaurant: draft.restaurant.trim(),
      name: draft.name.trim(),
      id,
      macros: { ...macros, ...targets() },
      checkedAt: new Date().toISOString(),
    };
    if (
      saveOrders(
        [order, ...orders.filter((o) => o.id !== id)],
        "Order saved in this browser. Recheck the restaurant source when menus or your order change.",
      )
    ) {
      setEditingId(id);
      setStage("saved");
    }
  };
  const changeDraft = (key: keyof typeof blank, value: string) => {
    setDraft({ ...draft, [key]: value });
    setMacros({ ...macros, confirmed: false });
  };
  const matches = RESTAURANTS.filter((r) => restaurantMatches(r.name, query));
  useEffect(() => {
    if (stage === "review") reviewRef.current?.focus({ preventScroll: true });
  }, [stage]);
  return (
    <section className="food-restaurant" aria-label="Restaurant macro finder">
      <div className="food-actions" role="group" aria-label="Restaurant finder steps">
        <Button
          aria-pressed={stage === "find"}
          variant={stage === "find" ? "default" : "outline"}
          onClick={() => setStage("find")}
        >
          1. Find a meal
        </Button>
        <Button
          aria-pressed={stage === "review"}
          variant={stage === "review" ? "default" : "outline"}
          onClick={() => setStage("review")}
        >
          2. Review &amp; compare
        </Button>
        <Button
          aria-pressed={stage === "saved"}
          variant={stage === "saved" ? "default" : "outline"}
          onClick={() => setStage("saved")}
        >
          Saved orders ({orders.length})
        </Button>
      </div>
      {note && (
        <p role="status" className="food-notice">
          {note}
        </p>
      )}
      <div hidden={stage !== "find"} className="food-restaurant-stage">
        <section className="food-card">
          <h3>Find restaurant meals</h3>
          <p>
            Search a restaurant, choose a meal, then compare its published nutrition with your
            targets.
          </p>
          <label>
            Restaurant or meal search
            <input
              type="search"
              maxLength={160}
              value={query}
              placeholder="Moe’s, chicken bowl…"
              onChange={(e) => {
                cancel();
                setQuery(e.target.value);
                setHits([]);
              }}
            />
          </label>
          <div className="food-actions">
            <Button
              disabled={busy || !query.trim()}
              onClick={() => void lookup({ op: "restaurant-search", query })}
            >
              Search menus online
            </Button>
            {query.trim() && (
              <a
                href={`https://duckduckgo.com/?${new URLSearchParams({ q: `${query.trim()} official restaurant nutrition menu` })}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open web search
              </a>
            )}
          </div>
          <p className="food-muted">
            Prefer the restaurant’s own nutrition guide. Choose a link to import or enter facts
            manually.
          </p>
          <Button variant="outline" onClick={() => setStage("review")}>
            Enter menu facts manually
          </Button>
          <details>
            <summary>Official restaurant nutrition links</summary>
            <div
              className="food-restaurant-directory"
              aria-label="Official restaurant nutrition starting points"
            >
              {matches.map((r) => (
                <div className="food-notice" key={r.name}>
                  <strong>{r.name}</strong>
                  <div className="food-actions">
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      Open official menu / nutrition
                    </a>
                    <Button
                      variant="outline"
                      onClick={() => {
                        cancel();
                        setUrl(r.url);
                        setDraft({ ...draft, restaurant: r.name });
                        setMacros({ ...macros, confirmed: false });
                      }}
                    >
                      Use {r.name}
                    </Button>
                  </div>
                </div>
              ))}
              {!matches.length && (
                <p className="food-muted">
                  No built-in starting point matches. Search online or paste any restaurant’s public
                  nutrition page below.
                </p>
              )}
            </div>
          </details>
          {hits.length > 0 && (
            <div aria-label="Restaurant web results">
              {hits.map((h) => (
                <div className="food-notice" key={h.url}>
                  <a href={h.url} target="_blank" rel="noopener noreferrer">
                    {h.title}
                  </a>
                  <Button
                    variant="outline"
                    onClick={() => {
                      cancel();
                      setUrl(h.url);
                    }}
                  >
                    Use this menu link
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="food-card" aria-label="Import restaurant nutrition">
          <h3>Get menu nutrition</h3>
          <label>
            Restaurant nutrition link
            <input
              type="url"
              maxLength={2000}
              value={url}
              onChange={(e) => {
                cancel();
                setUrl(e.target.value);
              }}
              placeholder="https://restaurant.example/nutrition"
            />
          </label>
          <Button
            disabled={busy || !url.trim()}
            onClick={() => {
              setMenu([]);
              void lookup({ op: "restaurant-import", url: url.trim() });
            }}
          >
            Load menu nutrition
          </Button>
          <p className="food-muted">
            Imports readable structured menus and labelled HTML tables. PDFs, interactive
            calculators and blocked sites need paste/manual entry. Opening or importing a link
            contacts that website; search snippets are never treated as nutrition facts.
          </p>
          {menu.length > 0 && (
            <>
              <label>
                Filter imported menu items
                <input
                  type="search"
                  maxLength={160}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <div className="food-menu-results" aria-label="Imported menu items">
                {menu
                  .filter((i) => restaurantMatches(i.name, filter))
                  .map((i, index) => (
                    <div className="food-notice" key={`${i.name}-${index}`}>
                      <strong>{i.name}</strong>
                      <p>{i.serving || "Serving size not provided"}</p>
                      <p className="food-muted">{i.nutrition}</p>
                      <Button variant="outline" onClick={() => choose(i)}>
                        Review {i.name}
                      </Button>
                    </div>
                  ))}
                {!menu.some((i) => restaurantMatches(i.name, filter)) && (
                  <p>No matching imported items.</p>
                )}
              </div>
            </>
          )}
          <details>
            <summary>Paste one menu item’s nutrition</summary>
            <label>
              Menu item nutrition text
              <textarea
                rows={7}
                maxLength={24000}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={
                  "Chicken bowl\nServing size: 1 bowl\nCalories: 500 kcal\nProtein: 40 g\nCarbs: 50 g\nFat: 15 g"
                }
              />
            </label>
            <Button
              variant="outline"
              disabled={!pasted.trim()}
              onClick={() => {
                const item = pastedMenuFood(pasted);
                if (item) choose({ ...item, source: recipeUrl(url)?.toString() ?? "" });
                else
                  setNote(
                    "Paste one item name followed by labelled values, e.g. Calories: 500 kcal and Protein: 40 g. For tables or unclear units, enter the fields manually.",
                  );
              }}
            >
              Use pasted menu facts
            </Button>
          </details>
          {busy && (
            <div className="food-actions" role="status">
              <span>Looking up menu information…</span>
              <Button variant="ghost" onClick={cancel}>
                Cancel restaurant lookup
              </Button>
            </div>
          )}
        </section>
      </div>
      <div hidden={stage !== "review"}>
        <section className="food-card" aria-label="Review restaurant order">
          <h3 ref={reviewRef} tabIndex={-1}>
            Your restaurant order
          </h3>
          <p className="food-muted">
            Enter manually or choose an imported item. Use the exact size and customization; add
            sides, sauces and drinks to your published totals. An ingredient row is not a whole
            meal.
          </p>
          <label>
            Restaurant name
            <input
              maxLength={160}
              value={draft.restaurant}
              onChange={(e) => changeDraft("restaurant", e.target.value)}
            />
          </label>
          <label>
            Menu item / complete order
            <input
              maxLength={240}
              value={draft.name}
              onChange={(e) => changeDraft("name", e.target.value)}
            />
          </label>
          <label>
            Serving size / order details
            <input
              maxLength={240}
              value={draft.serving}
              onChange={(e) => changeDraft("serving", e.target.value)}
              placeholder="1 bowl, chicken, no cheese; includes…"
            />
          </label>
          <label>
            Nutrition source (optional HTTPS link)
            <input
              type="url"
              maxLength={2000}
              value={draft.source}
              onChange={(e) => changeDraft("source", e.target.value)}
            />
          </label>
          <FoodMacroCheck
            context="restaurant"
            recipe={{
              title: draft.name,
              ingredients: [],
              steps: [],
              servings: draft.serving,
              source: recipeUrl(draft.source)?.toString() ?? "",
              nutrition: sourceFacts,
            }}
            value={macros}
            onChange={setMacros}
          />
          <div className="food-actions">
            <Button disabled={!ready} onClick={save}>
              {editingId ? "Update saved order" : "Save reviewed order"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(blank);
                setMacros({ ...initialFoodMacros(""), ...targets() });
                setSourceFacts("");
                setEditingId("");
                setNote("");
              }}
            >
              New order comparison
            </Button>
          </div>
        </section>
      </div>
      <div hidden={stage !== "saved"}>
        <section className="food-card" aria-label="Saved restaurant orders">
          <label>
            Search saved orders
            <input
              type="search"
              maxLength={160}
              value={savedQuery}
              onChange={(e) => setSavedQuery(e.target.value)}
            />
          </label>
          <h3>Saved orders · {orders.length}/30</h3>
          <p className="food-muted">
            Stored in this browser only. Results below use your currently entered meal targets.
            Saved values are from your last review, not a live menu; menus, portions and allergens
            can change.
          </p>
          {orders
            .filter((o) => restaurantMatches(`${o.restaurant} ${o.name}`, savedQuery))
            .map((o) => {
              const result = checkFoodMacros({ ...o.macros, ...targets() });
              return (
                <div className="food-notice" key={o.id}>
                  <strong>
                    {o.restaurant} · {o.name}
                  </strong>
                  <p>{o.serving}</p>
                  {result.portion && (
                    <p>
                      {Math.round(result.portion.calories)} kcal ·{" "}
                      {Math.round(result.portion.protein)} g protein ·{" "}
                      {Math.round(result.portion.carbs)} g carbs · {Math.round(result.portion.fat)}{" "}
                      g fat
                    </p>
                  )}
                  <p>
                    {result.verdict === "yes"
                      ? "Yes — fits current meal targets"
                      : result.verdict === "no"
                        ? "No — doesn’t fit current meal targets"
                        : "Set meal targets / review nutrition to compare"}
                  </p>
                  <p className="food-muted">
                    Last reviewed {new Date(o.checkedAt).toLocaleDateString()}
                    {!o.source && " · Manually entered; no source link saved"}
                  </p>
                  <div className="food-actions">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDraft({
                          restaurant: o.restaurant,
                          name: o.name,
                          serving: o.serving,
                          source: o.source,
                        });
                        setMacros({ ...o.macros, ...targets() });
                        setSourceFacts("");
                        setEditingId(o.id);
                        setNote(
                          "Loaded saved values. Recheck the current restaurant menu before relying on them.",
                        );
                        setStage("review");
                      }}
                    >
                      Compare {o.name}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (
                          saveOrders(
                            orders.filter((x) => x.id !== o.id),
                            "Saved order removed. Cooking progress is unchanged.",
                          ) &&
                          editingId === o.id
                        )
                          setEditingId("");
                      }}
                    >
                      Remove {o.name}
                    </Button>
                  </div>
                </div>
              );
            })}
          {!orders.length && (
            <p>Your reviewed orders will appear here for quick comparisons, including offline.</p>
          )}
          {!!orders.length &&
            !orders.some((o) => restaurantMatches(`${o.restaurant} ${o.name}`, savedQuery)) && (
              <p>No saved orders match your search.</p>
            )}
        </section>
      </div>
    </section>
  );
}
