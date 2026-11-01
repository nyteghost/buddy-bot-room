import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { currentUser } from "@/lib/accounts.server";
import { askPals } from "@/lib/ask.server";
import { recipePage } from "@/lib/recipe-import.server";
import { handleFocusFood } from "@/lib/focus-food.server";
import { handleSearch } from "@/lib/search.server";
vi.mock("@/lib/search.server", () => ({ handleSearch: vi.fn() }));
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/ask.server", () => ({ askPals: vi.fn() }));
vi.mock("@/lib/recipe-import.server", async importOriginal => ({ ...await importOriginal<object>(), recipePage: vi.fn() }));
const owner = vi.mocked(currentUser), ai = vi.mocked(askPals), page = vi.mocked(recipePage);
const request = (body: unknown) => new Request("http://localhost/api/focus-food", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("BUDDY_ACCOUNTS", "1"); vi.stubEnv("BUDDY_DATA_DIR", "/tmp/pixel-food-test"); owner.mockReset(); ai.mockReset(); page.mockReset(); owner.mockResolvedValue({ username: "owner", owner: true }); });
afterEach(() => vi.unstubAllEnvs());
it("requires owner before fetching websites or calling models", async () => {
  owner.mockResolvedValue({ username: "guest", owner: false });
  expect((await handleFocusFood(request({ op: "import", url: "https://example.com" }))).status).toBe(403);
  expect(page).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
});
it("structured imports make no AI call and retain exact source steps", async () => {
  page.mockResolvedValue({ html: '<script type="application/ld+json">{"@type":"Recipe","name":"Rice","recipeIngredient":["Rice"],"recipeInstructions":["Simmer 18 minutes."]}</script>', source: "https://example.com/rice" });
  const result = await handleFocusFood(request({ op: "import", url: "https://example.com/rice" }));
  expect(await result.json()).toMatchObject({ recipe: { steps: ["Simmer 18 minutes."], source: "https://example.com/rice" } }); expect(ai).not.toHaveBeenCalled();
});
it("explains a blocked website without leaking network details", async () => {
  page.mockRejectedValue(new Error("private ip 10.200.1.30"));
  const response = await handleFocusFood(request({ op: "import", url: "https://example.com" }));
  expect(response.status).toBe(422); expect(await response.text()).not.toContain("10.200");
});
it("falls back offline and never lets model advice replace original instruction", async () => {
  ai.mockResolvedValue({ ok: true, text: "Bake at 900 degrees for 1 minute.", via: "Local AI" });
  const response = await handleFocusFood(request({ op: "help", step: "Simmer 18 minutes." }));
  expect(await response.json()).toMatchObject({ source: "offline", text: expect.stringContaining("Simmer 18 minutes.") });
  expect(ai).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ localOnly: true, signal: expect.any(AbortSignal) }));
});
it("accepts verbatim AI organization but rejects changed cooking values", async () => {
  const recipe = { title: "Rice", ingredients: ["1 cup rice"], steps: ["Simmer 18 minutes."], source: "", servings: "", nutrition: "" };
  ai.mockResolvedValue({ ok: true, text: JSON.stringify(recipe), via: "Local AI" });
  const input = { op: "organize", text: "Rice\n1 cup rice\nSimmer 18 minutes." };
  expect((await handleFocusFood(request(input))).status).toBe(200);
  ai.mockResolvedValue({ ok: true, text: JSON.stringify({ ...recipe, steps: ["Simmer 2 minutes."] }), via: "Local AI" });
  expect((await handleFocusFood(request(input))).status).toBe(422);
});
it("rejects oversized bodies and aborts before network access", async () => {
  expect((await handleFocusFood(request({ op: "organize", text: "x".repeat(33000) }))).status).toBe(413);
  const controller = new AbortController(); controller.abort();
  expect((await handleFocusFood(new Request("http://localhost/api/focus-food", { method: "POST", body: JSON.stringify({ op: "import", url: "https://example.com" }), signal: controller.signal }))).status).toBe(499);
  expect(page).not.toHaveBeenCalled();
});
it("restaurant lookups require an owner before any website or search access", async () => {
  vi.mocked(handleSearch).mockReset(); owner.mockResolvedValue(null);
  for (const input of [{ op: "restaurant-search", query: "Moes" }, { op: "restaurant-import", url: "https://example.com/menu" }]) expect((await handleFocusFood(request(input))).status).toBe(403);
  expect(handleSearch).not.toHaveBeenCalled(); expect(page).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
});
it("restaurant search passes only a bounded query and never interprets snippets as macros", async () => {
  vi.mocked(handleSearch).mockReset();
  vi.mocked(handleSearch).mockResolvedValue(Response.json({ hits: [{ title: "Official menu", url: "https://example.com/menu", snippet: "500 calories" }, { title: "Private", url: "http://10.200.1.30/" }, { title: "Unsafe", url: "javascript:alert(1)" }] }));
  const result = await (await handleFocusFood(request({ op: "restaurant-search", query: "Moes bowl", calorieLimit: "600", proteinTarget: "40" }))).json();
  expect(result.hits).toHaveLength(1); expect(result.items).toBeUndefined();
  const forwarded = vi.mocked(handleSearch).mock.calls[0]![0];
  expect(forwarded.url).toContain("Moes+bowl"); expect(forwarded.url).not.toContain("600"); expect(forwarded.url).not.toContain("proteinTarget");
  expect((await handleFocusFood(request({ op: "restaurant-search", query: "x".repeat(161) }))).status).toBe(400);
  expect(ai).not.toHaveBeenCalled();
});
it("restaurant imports preserve missing values and use the SSRF-protected page loader, without AI", async () => {
  page.mockResolvedValue({ html: '<script type="application/ld+json">{"@type":"MenuItem","name":"Bowl","nutrition":{"calories":"500 kcal","proteinContent":"40 g"}}</script>', source: "https://example.com/menu" });
  const result = await (await handleFocusFood(request({ op: "restaurant-import", url: "https://example.com/menu" }))).json();
  expect(result.items[0]).toMatchObject({ name: "Bowl", nutrition: "calories: 500 kcal · proteinContent: 40 g", source: "https://example.com/menu" });
  expect(page).toHaveBeenCalledWith("https://example.com/menu", expect.any(AbortSignal)); expect(ai).not.toHaveBeenCalled();
});
it("menu/search failures explain manual fallback without leaking private endpoints", async () => {
  page.mockRejectedValue(new Error("10.200.1.30 private socket"));
  const result = await handleFocusFood(request({ op: "restaurant-import", url: "https://example.com/menu" }));
  expect(result.status).toBe(422); expect(await result.text()).not.toContain("10.200");
  vi.mocked(handleSearch).mockResolvedValue(Response.json({ error: "http://private-searx:8081" }, { status: 502 }));
  const search = await handleFocusFood(request({ op: "restaurant-search", query: "Moes" }));
  expect(search.status).toBe(502); expect(await search.text()).not.toContain("private-searx");
});
it("recipe search requires owner authentication before calling search or AI", async () => {
  vi.mocked(handleSearch).mockReset(); owner.mockResolvedValue(null);
  expect((await handleFocusFood(request({ op: "recipe-search", query: "chicken" }))).status).toBe(403);
  expect(handleSearch).not.toHaveBeenCalled(); expect(page).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
});
it("recipe search forwards only bounded query words and filters unsafe links", async () => {
  vi.mocked(handleSearch).mockReset(); vi.mocked(handleSearch).mockResolvedValue(Response.json({ hits: [{ title: "Recipe", url: "https://recipes.example/rice", snippet: "data" }, { title: "Private", url: "http://127.0.0.1/" }] }));
  const response = await handleFocusFood(request({ op: "recipe-search", query: "rice bowls", proteinTarget: "99", calorieLimit: "777" }));
  expect(await response.json()).toMatchObject({ hits: [{ title: "Recipe", url: "https://recipes.example/rice" }] });
  const url = vi.mocked(handleSearch).mock.calls[0]![0].url;
  expect(url).toContain("rice+bowls+recipe+ingredients+instructions"); expect(url).not.toContain("777"); expect(url).not.toContain("99");
  expect((await handleFocusFood(request({ op: "recipe-search", query: "x".repeat(161) }))).status).toBe(400);
  expect(page).not.toHaveBeenCalled(); expect(ai).not.toHaveBeenCalled();
});
it("recipe search failures do not expose the internal search service", async () => {
  vi.mocked(handleSearch).mockResolvedValue(Response.json({ error: "http://private-searx:8081" }, { status: 502 }));
  const response = await handleFocusFood(request({ op: "recipe-search", query: "rice" }));
  expect(response.status).toBe(502); expect(await response.text()).not.toContain("private-searx");
});
