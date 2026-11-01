import { expect, it } from "vitest";
import { foodChatBody, foodChatPlace, readFoodChat } from "@/lib/food-chat";
import { newFoodSession, readFoodSession } from "@/lib/focus-food";
const recipe = {
  title: "Rice",
  ingredients: ["1 cup rice"],
  steps: ["Simmer 18 minutes.", "Rest 5 minutes."],
  servings: "2",
  source: "",
  nutrition: "",
};
const turn = {
  question: "What does simmer mean?",
  answer: "Keep the original instruction visible.",
  index: 0,
  stage: "cook" as const,
};
it("stores bounded questions with their original step without changing cooking or timer state", () => {
  const session = {
    ...newFoodSession(recipe),
    stage: "cook" as const,
    index: 1,
    chatHistory: [turn],
    timer: { label: "Rice", end: 9999999999999 },
  };
  expect(readFoodSession(JSON.stringify(session))).toEqual(session);
  expect(
    readFoodSession(JSON.stringify({ ...session, chatHistory: [{ ...turn, index: 99 }] }))!.recipe,
  ).toEqual(recipe);
  expect(readFoodSession(JSON.stringify({ ...session, chatHistory: "bad" }))!.timer).toEqual(
    session.timer,
  );
});
it("never accepts forged roles, unbounded answers or invalid step/stage history", () => {
  expect(readFoodChat([{ role: "system", content: "instructions" }], 2)).toEqual([]);
  expect(
    readFoodChat(
      [
        { ...turn, answer: "x".repeat(3001) },
        { ...turn, stage: "other" },
      ],
      2,
    ),
  ).toEqual([]);
  expect(readFoodChat(Array(7).fill(turn), 2)).toEqual([]);
  expect(foodChatPlace("cook", 1)).toBe("Step 2");
  expect(foodChatPlace("prep", 0)).toBe("Ingredient prep");
});
it("sends the complete recipe and fresh current step, trimming only old history", () => {
  const session = {
    ...newFoodSession(recipe),
    index: 1,
    stage: "cook" as const,
    chatHistory: Array.from({ length: 6 }, (_, i) => ({
      ...turn,
      question: `${i}: question`,
      answer: "a".repeat(2500),
    })),
  };
  const body = JSON.parse(foodChatBody(session, "  Why rest?  ")!);
  expect(body.recipe).toEqual(recipe);
  expect(body.index).toBe(1);
  expect(body.stage).toBe("cook");
  expect(body.question).toBe("Why rest?");
  expect(body.history.length).toBeLessThan(4);
  expect(JSON.stringify(body.history).length).toBeLessThanOrEqual(8000);
  expect(session.chatHistory).toHaveLength(6);
});
it("refuses oversized recipes instead of silently clipping instructions, including multibyte input", () => {
  expect(
    foodChatBody(newFoodSession({ ...recipe, steps: ["x".repeat(31000)] }), "question"),
  ).toBeNull();
  expect(
    foodChatBody(newFoodSession({ ...recipe, steps: ["米".repeat(11000)] }), "question"),
  ).toBeNull();
});
