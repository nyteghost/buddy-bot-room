import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { recipeUrl } from "@/lib/focus-food";
import type { SearchHit } from "@/lib/search";

export function RecipeSearch({
  open,
  disabled,
  onSelect,
}: {
  open: boolean;
  disabled: boolean;
  onSelect: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const pending = useRef<AbortController | null>(null);
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  };
  useEffect(() => {
    if (!open) {
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
    }
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [open]);
  const search = async () => {
    if (!query.trim() || disabled) return;
    cancel();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNote("");
    setHits([]);
    try {
      const response = await fetch("/api/focus-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "recipe-search", query: query.trim() }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (controller.signal.aborted || pending.current !== controller) return;
      if (!response.ok) {
        setNote(
          typeof data.error === "string"
            ? data.error
            : "Recipe search is unavailable. Open a web search or paste a recipe link below.",
        );
        return;
      }
      const found = Array.isArray(data.hits)
        ? data.hits
            .filter(
              (h: SearchHit) =>
                h && typeof h.title === "string" && typeof h.url === "string" && recipeUrl(h.url),
            )
            .filter(
              (h: SearchHit, index: number, items: SearchHit[]) =>
                items.findIndex((item) => item.url === h.url) === index,
            )
            .slice(0, 6)
        : [];
      setHits(found);
      setNote(
        found.length
          ? "Choose a recipe to import its ingredients and cooking steps for review."
          : "No recipes found. Try a different search, open web search, or paste a recipe link below.",
      );
    } catch {
      if (!controller.signal.aborted)
        setNote(
          "Recipe search is unavailable. Open a web search or paste a recipe link below; saved cooking still works offline.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section className="food-card" aria-label="Find a recipe">
      <h3>Find a recipe</h3>
      <p>Search for a meal, then choose a recipe to bring it into your cook-along.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label>
          Recipe search
          <input
            type="search"
            maxLength={160}
            value={query}
            placeholder="High-protein chicken meal prep…"
            onChange={(e) => {
              cancel();
              setQuery(e.target.value);
              setHits([]);
              setNote("");
            }}
          />
        </label>
        <div className="food-actions">
          <Button type="submit" disabled={disabled || busy || !query.trim()}>
            Search recipes
          </Button>
          {query.trim() && (
            <a
              href={`https://duckduckgo.com/?${new URLSearchParams({ q: `${query.trim()} recipe ingredients instructions` })}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open recipe web search
            </a>
          )}
        </div>
      </form>
      {busy && (
        <div role="status" className="food-actions">
          <span>Finding recipes…</span>
          <Button variant="ghost" onClick={cancel}>
            Cancel recipe search
          </Button>
        </div>
      )}
      {note && (
        <p role="status" className="food-muted">
          {note}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="food-recipe-results" aria-label="Recipe search results">
          {hits.map((h) => (
            <li className="food-notice" key={h.url}>
              <h3>{h.title}</h3>
              <p className="food-muted">{new URL(h.url).hostname}</p>
              {typeof h.snippet === "string" && h.snippet && <p>{h.snippet.slice(0, 280)}</p>}
              <div className="food-actions">
                <Button
                  disabled={disabled || busy}
                  onClick={() => {
                    cancel();
                    onSelect(h.url);
                  }}
                >
                  Use this recipe
                </Button>
                <a href={h.url} target="_blank" rel="noopener noreferrer">
                  Open source
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>About recipe search</summary>
        <p className="food-muted">
          In-app search uses your configured SearXNG service. Only search words are sent, never your
          macro targets or cooking progress. Search descriptions do not verify nutrition or dietary
          suitability. Importing contacts the selected website; some sites block imports or have no
          readable recipe data. You can still paste or enter a recipe manually.
        </p>
      </details>
    </section>
  );
}
