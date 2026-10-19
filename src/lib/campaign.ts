import { useSyncExternalStore } from "react";

/**
 * Dungeon Master mode. When a campaign is active the first seated pal is the Dungeon Master and the others
 * are party members. State lives in this browser only. Pure helpers are separate from the storage hook.
 */
export type Campaign = {
  active: boolean;
  title: string;
  premise: string;
  character: string;
  facts: string[];
  rolls: string[];
};
export const emptyCampaign: Campaign = { active: false, title: "", premise: "", character: "", facts: [], rolls: [] };
export const MAX_FACTS = 30;
export const MAX_ROLLS = 5;
const clean = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

export function startCampaign(premise: string): Campaign {
  const p = clean(premise, 300);
  return { ...emptyCampaign, active: true, premise: p, title: p.length > 48 ? `${p.slice(0, 47)}…` : p };
}
export const endCampaign = (c: Campaign): Campaign => ({ ...c, active: false });
export const setCharacter = (c: Campaign, text: string): Campaign => ({ ...c, character: clean(text, 300) });
export function addFact(c: Campaign, text: string): Campaign {
  const f = clean(text, 200);
  if (!f || c.facts.some((x) => x.toLowerCase() === f.toLowerCase())) return c;
  return { ...c, facts: [...c.facts, f].slice(-MAX_FACTS) };
}
export const removeFact = (c: Campaign, n: number): Campaign =>
  Number.isInteger(n) && n >= 1 && n <= c.facts.length ? { ...c, facts: c.facts.filter((_, i) => i !== n - 1) } : c;
export const addRoll = (c: Campaign, text: string): Campaign => ({ ...c, rolls: [...c.rolls, text.replace(/\*\*/g, "").slice(0, 120)].slice(-MAX_ROLLS) });

/** What the pals are told about the campaign each turn. Capped so it can't swamp small models. */
export function campaignContext(c: Campaign, maxChars = 1500): string {
  if (!c.active) return "";
  const lines = [
    `Campaign: ${c.title || "Untitled adventure"}`,
    c.premise ? `Premise: ${c.premise}` : "",
    c.character ? `The player's character: ${c.character}` : "",
    c.facts.length ? `Established facts:\n${c.facts.map((f) => `- ${f}`).join("\n")}` : "",
    c.rolls.length ? `The player's most recent dice rolls (oldest first; use them, never re-roll):\n${c.rolls.map((r) => `- ${r}`).join("\n")}` : "",
  ].filter(Boolean);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export function statusText(c: Campaign): string {
  if (!c.active && !c.title) return "No campaign yet. Start one with `/dm start a haunted lighthouse on a stormy coast`.";
  return [
    `**${c.title || "Untitled adventure"}** — ${c.active ? "in progress" : "paused (use /dm start to begin a new one)"}`,
    c.character ? `Your character: ${c.character}` : "No character set. Try `/dm character a nervous halfling locksmith`.",
    c.facts.length ? "Facts:\n" + c.facts.map((f, i) => `${i + 1}. ${f}`).join("\n") : "No facts saved. Use `/dm fact <text>` for things the pals must not forget.",
  ].join("\n");
}

const KEY = "pixel-pals-campaign-v1";
const listeners = new Set<() => void>();
let cache: Campaign | null = null;
export function parseCampaign(raw: unknown): Campaign {
  const c = raw as Partial<Campaign> | null;
  if (!c || typeof c !== "object") return emptyCampaign;
  const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-max) : []);
  return {
    active: c.active === true,
    title: typeof c.title === "string" ? c.title.slice(0, 60) : "",
    premise: typeof c.premise === "string" ? c.premise.slice(0, 300) : "",
    character: typeof c.character === "string" ? c.character.slice(0, 300) : "",
    facts: strs(c.facts, MAX_FACTS),
    rolls: strs(c.rolls, MAX_ROLLS),
  };
}
function read(): Campaign {
  if (cache) return cache;
  try { cache = parseCampaign(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { cache = emptyCampaign; }
  return cache;
}
export const getCampaign = read;
export function updateCampaign(fn: (c: Campaign) => Campaign) {
  cache = fn(read());
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}
export const useCampaign = (): Campaign => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => emptyCampaign);

export type DmRole = "dm" | "party";
export const isDmRole = (v: unknown): v is DmRole => v === "dm" || v === "party";

export const DM_SETTING = "a tabletop role-playing adventure: one pal is the Dungeon Master, the other pals are the player's adventuring party";

/** The per-turn instruction for the pal playing this role. Server-side prompt text; no secrets here. */
export function dmTask(role: DmRole): string {
  return role === "dm"
    ? "You are the Dungeon Master. The human is the player. Narrate what happens as a result of their latest action: vivid, concrete and fair, in 80-140 words. Honor the dice rolls you are given and never roll for the player or decide what their character does or feels. Keep consequences meaningful, keep it PG-13, and end by asking what they do next or offering two or three options. Write only your own narration, without a name prefix."
    : "You are a companion in the player's adventuring party. React to what the Dungeon Master just narrated, in character, in 30-60 words: one concrete action or line of dialogue. Do not narrate outcomes, roll dice or speak for the player or the other companions. Write only your own lines, without a name prefix.";
}
