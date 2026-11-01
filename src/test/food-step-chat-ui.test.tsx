import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { FoodStepChat } from "@/components/food-step-chat";
import { FocusFood } from "@/components/focus-food";
import { FOOD_KEY, newFoodSession, readFoodSession, type FoodSession } from "@/lib/focus-food";
vi.mock("@/components/pixel-character", () => ({ PixelCharacter: () => <span>Pal</span> }));
const recipe = {
  title: "Rice",
  ingredients: ["1 cup rice"],
  steps: ["Simmer 18 minutes.", "Rest 5 minutes."],
  servings: "2",
  source: "",
  nutrition: "",
};
const session: FoodSession = {
  ...newFoodSession(recipe),
  stage: "cook",
  index: 1,
  timer: { label: "Rice", end: 9999999999999 },
};
function Harness() {
  const [value, setValue] = useState(session);
  return (
    <>
      <FoodStepChat
        open
        session={value}
        onHistory={(chatHistory) => setValue({ ...value, chatHistory })}
        onReturn={() => {}}
      />
      <output data-testid="session">{JSON.stringify(value)}</output>
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function question() {
  fireEvent.click(screen.getByRole("button", { name: "Ask about this step" }));
  fireEvent.change(screen.getByLabelText("Question about this recipe"), {
    target: { value: "Why do I rest it?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask cooking assistant" }));
}
it("answers with the current recipe/step and keeps the conversation on return without advancing or stopping a timer", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      text: "This is the recipe’s resting step. Follow the original rest instruction.",
      source: "local-ai",
    }),
  );
  render(<Harness />);
  question();
  await within(screen.getByRole("log")).findByText(/This is the recipe’s resting step/);
  const sent = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(sent).toMatchObject({
    op: "chat",
    recipe,
    index: 1,
    stage: "cook",
    question: "Why do I rest it?",
  });
  const saved = JSON.parse(screen.getByTestId("session").textContent!);
  expect(saved.index).toBe(1);
  expect(saved.timer).toEqual(session.timer);
  expect(saved.chatHistory[0].index).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Back to recipe" }));
  expect(screen.queryByRole("log")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ask about this step" }));
  expect(
    within(screen.getByRole("log")).getByText(/This is the recipe’s resting step/),
  ).toBeInTheDocument();
});
it("cancels stale answers when the step changes and sends the new step on the next question", async () => {
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const save = vi.fn(),
    view = render(<FoodStepChat open session={session} onHistory={save} onReturn={() => {}} />);
  question();
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  view.rerender(
    <FoodStepChat open session={{ ...session, index: 0 }} onHistory={save} onReturn={() => {}} />,
  );
  expect(signal.aborted).toBe(true);
  resolve(Response.json({ text: "Late reply for step two" }));
  await waitFor(() => expect(save).not.toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Ask cooking assistant" }));
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string).index).toBe(0);
});
it("retains the question on local-AI failure and never substitutes a made-up answer", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "Local AI could not answer. Check Connect Ollama." }, { status: 503 }),
  );
  render(<Harness />);
  question();
  await screen.findByText("Local AI could not answer. Check Connect Ollama.");
  expect(screen.getByLabelText("Question about this recipe")).toHaveValue("Why do I rest it?");
  expect(JSON.parse(screen.getByTestId("session").textContent!)).not.toHaveProperty("chatHistory");
});
it("Back to recipe and hiding the panel cancel work without losing a draft", () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const back = vi.fn(),
    view = render(<FoodStepChat open session={session} onHistory={() => {}} onReturn={back} />);
  question();
  const first = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Back to recipe" }));
  expect(first.aborted).toBe(true);
  expect(back).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Ask about this step" }));
  expect(screen.getByLabelText("Question about this recipe")).toHaveValue("Why do I rest it?");
  fireEvent.click(screen.getByRole("button", { name: "Ask cooking assistant" }));
  const second = vi.mocked(fetch).mock.calls[1]![1]!.signal as AbortSignal;
  view.rerender(
    <FoodStepChat open={false} session={session} onHistory={() => {}} onReturn={back} />,
  );
  expect(second.aborted).toBe(true);
});
it("reload restores answered questions with the saved cooking session and new questions use the latest step", async () => {
  localStorage.setItem(
    FOOD_KEY,
    JSON.stringify({
      ...session,
      chatHistory: [
        { question: "Earlier question", answer: "Earlier answer", index: 0, stage: "cook" },
      ],
    }),
  );
  render(<FocusFood open />);
  fireEvent.click(screen.getByRole("button", { name: "Ask about this step" }));
  expect(screen.getByText(/Earlier answer/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cooking chat · Step 2" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to recipe" }));
  expect(screen.getByRole("heading", { name: "Step 2 of 2" })).toHaveFocus();
  expect(readFoodSession(localStorage.getItem(FOOD_KEY))!.timer).toEqual(session.timer);
});
