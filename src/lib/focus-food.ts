import { readFoodChat, type FoodChatTurn } from "./food-chat";
import { readPowderAddition, type PowderAddition } from "./protein-powder";
import { readFoodMacros, type FoodMacros } from "./food-macros";
export const FOOD_KEY = "pixel-pals-focus-food-v1";
export type FoodRecipe = { powderAddition?: PowderAddition; title: string; ingredients: string[]; steps: string[]; servings: string; source: string; nutrition: string };
export type FoodSession = { chatHistory?: FoodChatTurn[]; macroCheck?: FoodMacros; version: 1; recipe: FoodRecipe; index: number; checked: number[]; stage: "prep" | "cook" | "done"; portions: string; timer: { label: string; end: number } | null };
const line = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
export function validRecipe(value: unknown): FoodRecipe | null {
  if (!value || typeof value !== "object") return null;
  const r = value as FoodRecipe;
  if (JSON.stringify(value).length > 200000 || !line(r.title, 240) || !Array.isArray(r.ingredients) || !r.ingredients.length || r.ingredients.length > 150 || !r.ingredients.every(x => line(x, 1200)) ||
    !Array.isArray(r.steps) || !r.steps.length || r.steps.length > 100 || !r.steps.every(x => line(x, 6000)) ||
    typeof r.servings !== "string" || r.servings.length > 240 || typeof r.nutrition !== "string" || r.nutrition.length > 2000 || typeof r.source !== "string" || r.source.length > 2000) return null;
  if (r.source && !recipeUrl(r.source)) return null;
  const powderAddition = readPowderAddition(r.powderAddition);
  return { ...(powderAddition ? { powderAddition } : {}), title: r.title, ingredients: [...r.ingredients], steps: [...r.steps], servings: r.servings, nutrition: r.powderAddition && !powderAddition ? "" : r.nutrition, source: r.source };
}
export function recipeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (raw.length > 2000 || u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || /\.(local|localhost|internal|test|invalid)$/i.test(u.hostname)) return null;
    u.hash = ""; return u;
  } catch { return null; }
}
/** Deliberately conservative: never split on punctuation inside a cooking instruction. */
export function pastedRecipe(raw: string): FoodRecipe | null {
  if (raw.length > 24000) return null;
  const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const ingredients = lines.findIndex(x => /^ingredients\s*:?$/i.test(x));
  const steps = lines.findIndex((x, i) => i > ingredients && /^(instructions|directions|method|steps)\s*:?$/i.test(x));
  if (ingredients < 0 || steps <= ingredients + 1) return null;
  return validRecipe({ title: ingredients > 0 ? lines[0] : "My recipe", ingredients: lines.slice(ingredients + 1, steps), steps: lines.slice(steps + 1), servings: "", source: "", nutrition: "" });
}
export function newFoodSession(recipe: FoodRecipe): FoodSession {
  return { version: 1, recipe, index: 0, checked: [], stage: "prep", portions: "", timer: null };
}
export function readFoodSession(raw: string | null): FoodSession | null {
  if (!raw || raw.length > 240000) return null;
  try {
    const s = JSON.parse(raw) as FoodSession, recipe = validRecipe(s?.recipe);
    if (!recipe || s.version !== 1 || !["prep", "cook", "done"].includes(s.stage) || !Number.isInteger(s.index) || s.index < 0 || s.index >= recipe.steps.length || !Array.isArray(s.checked) || s.checked.length > recipe.ingredients.length || !s.checked.every(x => Number.isInteger(x) && x >= 0 && x < recipe.ingredients.length) || typeof s.portions !== "string" || s.portions.length > 80) return null;
    if (s.timer !== null && (!s.timer || !line(s.timer.label, 80) || !Number.isFinite(s.timer.end) || s.timer.end < 0)) return null;
    const macroCheck = readFoodMacros(s.macroCheck);
    const chatHistory = readFoodChat(s.chatHistory, recipe.steps.length);
    return { ...(chatHistory.length ? { chatHistory } : {}), ...(macroCheck ? { macroCheck } : {}), version: 1, recipe, index: s.index, checked: [...new Set(s.checked)], stage: s.stage, portions: s.portions, timer: s.timer };
  } catch { return null; }
}
export function foodCoach(step: string): string {
  return `Read this instruction once. Find the ingredients and equipment it names, then work through it at your pace. Keep every temperature, time and doneness check in the original instruction below. If anything is unclear, pause and check the source recipe.\n\nYour instruction: ${step}`;
}
