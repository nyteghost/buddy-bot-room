import { scrubChatText, scrubChatData } from "./chat-scrub";
import type { FoodSession } from "./focus-food";

export type FoodChatTurn = {
  question: string;
  answer: string;
  index: number;
  stage: "prep" | "cook" | "done";
};
export function readFoodChat(value: unknown, stepCount: number): FoodChatTurn[] {
  if (!Array.isArray(value) || value.length > 6) return [];
  return value.flatMap((v: FoodChatTurn) => {
    if (
      !v ||
      typeof v.question !== "string" ||
      !v.question.trim() ||
      v.question.length > 1000 ||
      typeof v.answer !== "string" ||
      !v.answer.trim() ||
      v.answer.length > 3000 ||
      !Number.isInteger(v.index) ||
      v.index < 0 ||
      v.index >= stepCount ||
      !["prep", "cook", "done"].includes(v.stage)
    )
      return [];
    return [
      {
        question: scrubChatText(v.question),
        answer: scrubChatText(v.answer),
        index: v.index,
        stage: v.stage,
      },
    ];
  });
}
export function foodChatPlace(stage: FoodChatTurn["stage"], index: number): string {
  return stage === "prep"
    ? "Ingredient prep"
    : stage === "done"
      ? "Recipe checklist complete"
      : `Step ${index + 1}`;
}
/** Keep a complete recipe and current step; trim only old conversation, never cooking instructions. */
export function foodChatBody(session: FoodSession, question: string): string | null {
  const { title, ingredients, steps, servings, nutrition, source } = session.recipe;
  const history = readFoodChat(session.chatHistory, steps.length).slice(-4);
  while (history.length && JSON.stringify(history).length > 8000) history.shift();
  const make = () =>
    JSON.stringify(
      scrubChatData({
        op: "chat",
        question: question.trim(),
        recipe: { title, ingredients, steps, servings, nutrition, source },
        index: session.index,
        stage: session.stage,
        history,
      }),
    );
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  while (history.length && bytes(make()) > 30000) history.shift();
  const body = make();
  return bytes(body) <= 30000 ? body : null;
}
