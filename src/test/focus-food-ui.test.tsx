import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FocusFood } from "@/components/focus-food";
import { FOOD_KEY, readFoodSession } from "@/lib/focus-food";
vi.mock("@/components/pixel-character", () => ({ PixelCharacter: () => <span>Pal</span> }));
beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function start() {
  render(<FocusFood open />);
  fireEvent.change(screen.getByLabelText("Paste recipe text"), { target: { value: "Rice\nIngredients\n1 cup rice\nInstructions\nSimmer 18 minutes.\nRest 5 minutes." } });
  fireEvent.click(screen.getByRole("button", { name: "Use pasted text" }));
  fireEvent.click(screen.getByRole("button", { name: "Save recipe and get ready" }));
}
it("requires review, preserves recipe and advances only on explicit completion", async () => {
  await start();
  expect(screen.getByRole("checkbox", { name: "1 cup rice" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /I’m ready/ }));
  fireEvent.click(screen.getByRole("button", { name: /I’m stuck/ }));
  expect(readFoodSession(localStorage.getItem(FOOD_KEY))?.index).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Done with this step" }));
  expect(screen.getByRole("heading", { name: "Step 2 of 2" })).toBeInTheDocument();
  await waitFor(() => expect(readFoodSession(localStorage.getItem(FOOD_KEY))?.index).toBe(1));
  cleanup(); render(<FocusFood open />);
  expect(screen.getByRole("heading", { name: "Step 2 of 2" })).toBeInTheDocument();
});
it("pause keeps a running timer, and hiding the window retains the current session", async () => {
  await start(); fireEvent.click(screen.getByRole("button", { name: /I’m ready/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
  const end = readFoodSession(localStorage.getItem(FOOD_KEY))?.timer?.end;
  fireEvent.click(screen.getByRole("button", { name: "Pause / save my place" }));
  expect(screen.getByText(/does not pause cooking/)).toBeInTheDocument();
  expect(readFoodSession(localStorage.getItem(FOOD_KEY))?.timer?.end).toBe(end);
});
