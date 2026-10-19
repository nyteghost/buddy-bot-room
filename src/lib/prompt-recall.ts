/**
 * Shell-style prompt history for the composer: ↑ walks back through what you've sent, ↓ walks
 * forward again and finally restores whatever you were typing. Never hijacks normal caret
 * movement — it only engages on an empty box or while you're already stepping through history.
 */
export type RecallState = { index: number; draft: string };
export const freshRecall: RecallState = { index: -1, draft: "" };

/** User prompts, newest first, with consecutive repeats collapsed. */
export function promptHistory(texts: string[]): string[] {
  const out: string[] = [];
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i]?.trim();
    if (text && text !== out[out.length - 1]) out.push(text);
  }
  return out;
}

export function recallStep(
  state: RecallState,
  key: "ArrowUp" | "ArrowDown",
  value: string,
  history: string[],
): { state: RecallState; value: string } | null {
  if (!history.length) return null;
  const stepping = state.index >= 0 && value === history[state.index];
  if (key === "ArrowUp") {
    if (!stepping && value !== "") return null; // a draft in progress: leave the caret alone
    const index = stepping ? Math.min(state.index + 1, history.length - 1) : 0;
    return { state: { index, draft: stepping ? state.draft : value }, value: history[index] ?? "" };
  }
  if (!stepping) return null;
  const index = state.index - 1;
  return index < 0
    ? { state: freshRecall, value: state.draft }
    : { state: { index, draft: state.draft }, value: history[index] ?? "" };
}
