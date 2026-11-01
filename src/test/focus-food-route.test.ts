import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { currentUser } from "@/lib/accounts.server";
import { askPals } from "@/lib/ask.server";
import { recipePage } from "@/lib/recipe-import.server";
import { handleFocusFood } from "@/lib/focus-food.server";
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
