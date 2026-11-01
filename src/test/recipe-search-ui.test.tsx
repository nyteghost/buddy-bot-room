import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipeSearch } from "@/components/recipe-search";
import { FocusFood } from "@/components/focus-food";
import { FOOD_KEY, readFoodSession } from "@/lib/focus-food";
vi.mock("@/components/pixel-character", () => ({ PixelCharacter: () => <span>Pal</span> }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const hit = {
  title: "Chicken bowls",
  url: "https://recipes.example/chicken",
  snippet: "A source description, not verified macros.",
};
const fill = (value: string) =>
  fireEvent.change(screen.getByLabelText("Recipe search"), { target: { value } });
it("searches only after a user action and imports the selected source into review before cooking", async () => {
  const recipe = {
    title: "Chicken bowls",
    ingredients: ["1 cup rice"],
    steps: ["Simmer 18 minutes."],
    source: hit.url,
    servings: "2",
    nutrition: "",
  };
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ hits: [hit] }))
    .mockResolvedValueOnce(Response.json({ recipe }));
  render(<FocusFood open />);
  fill("chicken meal prep");
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Search recipes" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use this recipe" }));
  await screen.findByRole("heading", { name: "Review before cooking" });
  expect(screen.getByLabelText("Recipe title")).toHaveValue("Chicken bowls");
  expect(screen.getByLabelText("Full instructions — blank line between steps")).toHaveValue(
    "Simmer 18 minutes.",
  );
  expect(readFoodSession(localStorage.getItem(FOOD_KEY))).toBeNull();
  expect(vi.mocked(fetch).mock.calls[1]![1]!.body).toBe(
    JSON.stringify({ op: "import", url: hit.url }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save recipe and get ready" }));
  expect(screen.getByRole("checkbox", { name: "1 cup rice" })).toBeInTheDocument();
});
it("renders only safe links, keeps snippets as text, and passes only the selected URL", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      hits: [
        hit,
        hit,
        { ...hit, url: "javascript:alert(1)" },
        { ...hit, url: "http://10.200.1.30/" },
        { ...hit, url: "https://other.example/recipe", title: "<script>bad</script>" },
      ],
    }),
  );
  const select = vi.fn();
  render(<RecipeSearch open disabled={false} onSelect={select} />);
  fill("bowls");
  fireEvent.submit(screen.getByLabelText("Recipe search").closest("form")!);
  await screen.findByText("<script>bad</script>");
  expect(screen.getAllByRole("button", { name: "Use this recipe" })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Use this recipe" })[0]!);
  expect(select).toHaveBeenCalledWith(hit.url);
});
it("shows a readable unavailable-search message and leaves the direct import form usable", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "Recipe search is unavailable. Paste a recipe link." }, { status: 502 }),
  );
  render(<FocusFood open />);
  fill("dinner");
  fireEvent.click(screen.getByRole("button", { name: "Search recipes" }));
  await screen.findByText("Recipe search is unavailable. Paste a recipe link.");
  expect(screen.getByRole("link", { name: "Open recipe web search" })).toHaveAttribute(
    "href",
    expect.stringContaining("duckduckgo.com"),
  );
  expect(screen.getByLabelText("Recipe link")).toBeEnabled();
});
it("ignores late search replies after changing the query or hiding the panel", async () => {
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<RecipeSearch open disabled={false} onSelect={() => {}} />);
  fill("chicken");
  fireEvent.click(screen.getByRole("button", { name: "Search recipes" }));
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  fill("rice");
  expect(signal.aborted).toBe(true);
  resolve(Response.json({ hits: [hit] }));
  await waitFor(() => expect(screen.queryByText(hit.title)).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Search recipes" }));
  const nextSignal = vi.mocked(fetch).mock.calls[1]![1]!.signal as AbortSignal;
  view.rerender(<RecipeSearch open={false} disabled={false} onSelect={() => {}} />);
  expect(nextSignal.aborted).toBe(true);
});
it("never automatically searches with blank input or while an import is busy", () => {
  render(<RecipeSearch open disabled onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: "Search recipes" })).toBeDisabled();
  fill("chicken");
  fireEvent.submit(screen.getByLabelText("Recipe search").closest("form")!);
  expect(fetch).not.toHaveBeenCalled();
});
