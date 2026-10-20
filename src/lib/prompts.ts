/** Saved prompts: one-click starting points for the message box. Pure helpers; storage is in prompts-store.ts. */
export type SavedPrompt = { id: string; name: string; text: string };
export const MAX_PROMPTS = 40;

export const BUILT_IN_PROMPTS: SavedPrompt[] = [
  { id: "b-summarize", name: "summarize", text: "Summarize this in five bullet points, then list any decisions or action items:\n\n" },
  { id: "b-reply", name: "reply", text: "Draft a short, friendly reply to this message. Keep my voice casual and ask one clarifying question if anything is unclear:\n\n" },
  { id: "b-week", name: "plan-week", text: "Help me plan my week. Here is what I have to do and what's on my calendar. Suggest a realistic order and flag anything that clashes:\n\n" },
  { id: "b-simple", name: "explain", text: "Explain this simply, as if I'm smart but new to the topic, with one small example:\n\n" },
  { id: "b-proscons", name: "pros-cons", text: "Give me the pros and cons of this decision, then say which way you'd lean and why:\n\n" },
  { id: "b-debug", name: "debug", text: "Help me debug this. Ask what you need, then walk through the most likely causes from most to least likely:\n\n" },
];

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

export function parsePrompts(raw: unknown): SavedPrompt[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): SavedPrompt[] => {
    const o = p as Partial<SavedPrompt> | null;
    return o && typeof o.id === "string" && typeof o.name === "string" && typeof o.text === "string" && o.name && o.text
      ? [{ id: o.id.slice(0, 24), name: slug(o.name), text: o.text.slice(0, 2000) }] : [];
  }).filter((p) => p.name).slice(0, MAX_PROMPTS);
}

export function addPrompt(list: SavedPrompt[], name: string, text: string, id: string): { ok: true; list: SavedPrompt[] } | { ok: false; error: string } {
  const n = slug(name);
  const t = text.trim().slice(0, 2000);
  if (!n) return { ok: false, error: "Give the prompt a short name, like /prompt save weekly-notes = Summarize my notes:" };
  if (!t) return { ok: false, error: "What should the prompt say? /prompt save <name> = <text>" };
  if (BUILT_IN_PROMPTS.some((b) => b.name === n)) return { ok: false, error: `“${n}” is a built-in prompt name. Pick another.` };
  const rest = list.filter((p) => p.name !== n);
  if (rest.length >= MAX_PROMPTS) return { ok: false, error: `You already have ${MAX_PROMPTS} saved prompts.` };
  return { ok: true, list: [...rest, { id, name: n, text: t }] };
}

/** Exact name first, then a unique prefix ("sum" finds "summarize"). */
export function findPrompt(all: SavedPrompt[], name: string): SavedPrompt | undefined {
  const n = slug(name);
  if (!n) return undefined;
  const exact = all.find((p) => p.name === n);
  if (exact) return exact;
  const starts = all.filter((p) => p.name.startsWith(n));
  return starts.length === 1 ? starts[0] : undefined;
}

export type PromptArgs = { op: "list" | "save" | "remove" | "use"; name: string; text: string };

/** "/prompt", "/prompt save foo = text", "/prompt remove foo", "/prompt foo extra words". */
export function parsePromptArgs(raw: string): PromptArgs | { error: string } {
  const t = raw.trim();
  if (!t || /^list$/i.test(t)) return { op: "list", name: "", text: "" };
  const save = /^save\s+([^=]+?)\s*=\s*([\s\S]+)$/i.exec(t);
  if (save) return { op: "save", name: save[1] ?? "", text: save[2] ?? "" };
  if (/^save\b/i.test(t)) return { error: "Use: /prompt save <name> = <what to put in the message box>" };
  const rm = /^(?:remove|rm|delete)\s+(\S+)/i.exec(t);
  if (rm) return { op: "remove", name: rm[1] ?? "", text: "" };
  const [name = "", ...rest] = t.split(/\s+/);
  return { op: "use", name, text: rest.join(" ") };
}

export function promptList(saved: SavedPrompt[]): string {
  const line = (p: SavedPrompt) => `• **${p.name}** — ${p.text.replace(/\s+/g, " ").trim().slice(0, 70)}${p.text.length > 70 ? "…" : ""}`;
  return ["Built in:", ...BUILT_IN_PROMPTS.map(line), "", saved.length ? "Yours:" : "Yours: none yet. Save one with /prompt save <name> = <text>.", ...saved.map(line), "", "Use one with /prompt <name>. It fills the message box so you can add your text and send."].join("\n");
}
