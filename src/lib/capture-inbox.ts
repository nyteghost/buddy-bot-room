import { scrubChatText } from "./chat-scrub";
export type Suggestion = {
  id: string;
  kind: "task" | "idea" | "memory";
  text: string;
  firstStep: string;
  minutes: number | null;
  materials: string[];
  quote: string;
};
export type InboxMeta = {
  parked?: boolean;
  context?: { task: string; step: string };
  version: 1;
  status: "pending" | "reviewed" | "archived";
  revision: number;
  source: "text" | "audio";
  suggestions: Suggestion[];
  approved: { id: string; kind: string; target: string }[];
  job: {
    state: "pending" | "working" | "done" | "failed";
    attempts: number;
    next: number;
    note: string;
  };
  audio?: { name: string; type: string; bytes: number };
};
export const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
};
export const MAX_AUDIO = 8_000_000;
export function fallbackSuggestion(text: string): Suggestion[] {
  const clean = scrubChatText(text).trim();
  if (!clean) return [];
  return [
    {
      id: "s1",
      kind: /\b(need to|buy|call|pick up|clean|fix|finish|prepare)\b/i.test(clean)
        ? "task"
        : "idea",
      text: clean.slice(0, 200),
      firstStep: "Choose one small action you can start with.",
      minutes: null,
      materials: [],
      quote: clean.slice(0, 500),
    },
  ];
}
export function inboxMeta(text: string, source: "text" | "audio" = "text"): InboxMeta {
  return {
    version: 1,
    status: "pending",
    revision: 1,
    source,
    suggestions: source === "audio" ? [] : fallbackSuggestion(text),
    approved: [],
    job: {
      state: "pending",
      attempts: 0,
      next: 0,
      note: "Saved on Unraid; waiting for local processing.",
    },
  };
}
export function parseSuggestions(raw: unknown, source: string): Suggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).flatMap((value, i) => {
    if (!value || typeof value !== "object") return [];
    const v = value as Record<string, unknown>;
    const text = typeof v["text"] === "string" ? scrubChatText(v["text"]).trim().slice(0, 400) : "";
    const quote = typeof v["quote"] === "string" ? v["quote"].slice(0, 500) : "";
    if (
      !text ||
      !quote ||
      !source.includes(quote) ||
      !["task", "idea", "memory"].includes(String(v["kind"]))
    )
      return [];
    return [
      {
        id: "s" + (i + 1),
        kind: v["kind"] as Suggestion["kind"],
        text,
        firstStep:
          typeof v["firstStep"] === "string" ? scrubChatText(v["firstStep"]).slice(0, 300) : "",
        minutes:
          typeof v["minutes"] === "number" && Number.isFinite(v["minutes"])
            ? Math.max(1, Math.min(180, Math.round(v["minutes"])))
            : null,
        materials: Array.isArray(v["materials"])
          ? v["materials"]
              .filter((x): x is string => typeof x === "string")
              .slice(0, 8)
              .map((x) => scrubChatText(x).slice(0, 100))
          : [],
        quote: scrubChatText(quote),
      },
    ];
  });
}
export function validInbox(value: unknown): value is InboxMeta {
  if (!value || typeof value !== "object") return false;
  const v = value as InboxMeta;
  return (
    v["version"] === 1 &&
    (v.parked === undefined || typeof v.parked === "boolean") &&
    (!v.context ||
      (typeof v.context.task === "string" &&
        v.context.task.length <= 280 &&
        typeof v.context.step === "string" &&
        v.context.step.length <= 180)) &&
    ["pending", "reviewed", "archived"].includes(v["status"]) &&
    Number.isInteger(v["revision"]) &&
    v["revision"] > 0 &&
    ["text", "audio"].includes(v["source"]) &&
    Array.isArray(v["suggestions"]) &&
    Array.isArray(v["approved"]) &&
    !!v["job"] &&
    ["pending", "working", "done", "failed"].includes(v["job"].state) &&
    (!v["audio"] || /^[a-f0-9-]+\.(webm|ogg|m4a|mp3|wav|aac)$/.test(v["audio"].name))
  );
}
