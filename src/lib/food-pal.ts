import type { FoodSession } from "./focus-food";
export type KitchenAction = "gather" | "chop" | "mix" | "heat" | "wait" | "plate" | "rest" | "celebrate";
/** Visual accompaniment only. Never changes steps, cooking values, timers or readiness. */
export function foodPalAction(session: FoodSession, paused: boolean): KitchenAction {
  if (paused) return "rest";
  if (session.stage === "prep") return "gather";
  if (session.stage === "done") return "celebrate";
  const step = session.recipe.steps[session.index] ?? "";
  const match = /\b(chop|slice|dice|mince|peel|cut|mix|stir|whisk|combine|fold|beat|preheat|bake|roast|boil|simmer|fry|heat|cook|grill|steam|rest|cool|wait|chill|serve|plate|portion|pack|divide)\b/i.exec(step)?.[0]?.toLowerCase();
  if (match && /^(chop|slice|dice|mince|peel|cut)$/.test(match)) return "chop";
  if (match && /^(mix|stir|whisk|combine|fold|beat)$/.test(match)) return "mix";
  if (match && /^(preheat|bake|roast|boil|simmer|fry|heat|cook|grill|steam)$/.test(match)) return "heat";
  if (match && /^(rest|cool|wait|chill)$/.test(match)) return "wait";
  if (match && /^(serve|plate|portion|pack|divide)$/.test(match)) return "plate";
  return "gather";
}
export const kitchenCaptions: Record<KitchenAction, string> = {
  gather: "Gathering ingredients alongside you.", chop: "A little chopping in the pretend kitchen.", mix: "Mixing along in the pretend kitchen.", heat: "Keeping you company at the pretend stove.", wait: "Waiting alongside you.", plate: "Setting out pretend plates alongside you.", rest: "Taking a quiet pause with you.", celebrate: "Celebrating the steps you checked off.",
};
