import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RestaurantFood } from "@/components/restaurant-food";
import { FocusFood } from "@/components/focus-food";
import { FOOD_MACRO_TARGETS_KEY } from "@/lib/food-macros";
import { FOOD_KEY, newFoodSession } from "@/lib/focus-food";
import { RESTAURANT_FOOD_KEY } from "@/lib/restaurant-food";
vi.mock("@/components/pixel-character", () => ({ PixelCharacter: () => <span>Pal</span> }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function review() {
  fireEvent.click(screen.getByRole("button", { name: "2. Review & compare" }));
  fill("Restaurant name", "Example Grill");
  fill("Menu item / complete order", "Chicken bowl");
  fireEvent.click(screen.getByText("Review nutrition, portion and meal targets"));
  for (const [label, value] of [
    ["Source calories (kcal)", "500"],
    ["Source protein (g)", "40"],
    ["Source carbs (g)", "50"],
    ["Source fat (g)", "15"],
    ["Meal calorie budget (kcal)", "600"],
    ["Meal protein minimum (g)", "35"],
  ])
    fill(label!, value!);
  fill("Nutrition serving basis", "serving");
  fireEvent.click(screen.getByRole("checkbox"));
}
it("compares and saves a reviewed restaurant order offline, then restores without touching cooking", async () => {
  localStorage.setItem(FOOD_KEY, "cooking stays here");
  render(<RestaurantFood open />);
  review();
  expect(screen.getByText("Yes — fits your meal targets")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remember meal targets" }));
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed order" }));
  expect(JSON.parse(localStorage.getItem(RESTAURANT_FOOD_KEY)!)).toHaveLength(1);
  expect(localStorage.getItem(FOOD_KEY)).toBe("cooking stays here");
  expect(fetch).not.toHaveBeenCalled();
  cleanup();
  render(<RestaurantFood open />);
  fireEvent.click(screen.getByRole("button", { name: "Saved orders (1)" }));
  await waitFor(() =>
    expect(screen.getByText("Yes — fits current meal targets")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Compare Chicken bowl" }));
  expect(screen.getByText("Yes — fits your meal targets")).toBeInTheDocument();
  fill("Meal calorie budget (kcal)", "400");
  expect(screen.getByText("No — doesn’t fit current meal targets")).toBeInTheDocument();
  expect(screen.getByLabelText("Restaurant alternatives to compare")).toBeInTheDocument();
  fill("Menu item / complete order", "Different bowl");
  expect(screen.getByText("Not enough information to judge")).toBeInTheDocument();
});
it("loads structured menu items only on explicit action and requires review before comparison", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      items: [
        {
          name: "Chicken bowl",
          source: "https://restaurant.example/nutrition",
          serving: "1 bowl",
          nutrition: "calories: 500 kcal · protein: 40 g · carbs: 50 g · fat: 15 g",
        },
      ],
    }),
  );
  localStorage.setItem(
    FOOD_MACRO_TARGETS_KEY,
    JSON.stringify({ calorieLimit: "600", proteinTarget: "35", carbLimit: "", fatLimit: "" }),
  );
  render(<RestaurantFood open />);
  fill("Restaurant nutrition link", "https://restaurant.example/nutrition");
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load menu nutrition" }));
  await screen.findByRole("button", { name: "Review Chicken bowl" });
  fireEvent.click(screen.getByRole("button", { name: "Review Chicken bowl" }));
  expect(screen.getByLabelText("Source calories (kcal)")).toHaveValue("500");
  expect(screen.getByText("Not enough information to judge")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(
    "/api/focus-food",
    expect.objectContaining({
      body: JSON.stringify({
        op: "restaurant-import",
        url: "https://restaurant.example/nutrition",
      }),
    }),
  );
});
it("explains search failures and keeps manual comparison usable", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  render(<RestaurantFood open />);
  fill("Restaurant or meal search", "chicken bowl");
  fireEvent.click(screen.getByRole("button", { name: "Search menus online" }));
  await screen.findByText(/Saved orders and manual comparison still work offline/);
  review();
  expect(screen.getByText("Yes — fits your meal targets")).toBeInTheDocument();
});
it("cancels lookups when hidden and ignores a late reply", async () => {
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<RestaurantFood open />);
  fill("Restaurant or meal search", "bowls");
  fireEvent.click(screen.getByRole("button", { name: "Search menus online" }));
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  view.rerender(<RestaurantFood open={false} />);
  expect(signal.aborted).toBe(true);
  resolve(Response.json({ hits: [{ title: "Late menu", url: "https://restaurant.example" }] }));
  await waitFor(() => expect(screen.queryByText("Late menu")).not.toBeInTheDocument());
});
it("switching sections preserves a saved cooking session and its timer", async () => {
  const session = {
    ...newFoodSession({
      title: "Rice",
      ingredients: ["Rice"],
      steps: ["Simmer 18 minutes."],
      source: "",
      servings: "",
      nutrition: "",
    }),
    timer: { label: "Rice", end: Date.now() + 60000 },
  };
  localStorage.setItem(FOOD_KEY, JSON.stringify(session));
  render(<FocusFood open />);
  const group = screen.getByRole("group", { name: "Focus Food sections" });
  fireEvent.click(within(group).getByRole("button", { name: "Restaurant macros" }));
  expect(screen.getByRole("region", { name: "Restaurant macro finder" })).toBeVisible();
  expect(screen.getByText(/Your cooking timer is still running/)).toBeInTheDocument();
  fireEvent.click(within(group).getByRole("button", { name: "Cook a recipe" }));
  expect(screen.getByRole("checkbox", { name: "Rice" })).toBeVisible();
  expect(JSON.parse(localStorage.getItem(FOOD_KEY)!)).toEqual(session);
});
