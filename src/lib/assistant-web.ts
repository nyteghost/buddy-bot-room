import type { SearchHit } from "./search";
export type WebMode = "auto" | "on" | "off";
export type WebReceipt = {
  state: "off" | "not-needed" | "connected" | "no-results" | "unavailable";
  at: string;
  cached: boolean;
  hits: SearchHit[];
};
export function webMode(value: unknown, legacy?: unknown): WebMode {
  return value === "on" || value === "off" || value === "auto"
    ? value
    : legacy === true
      ? "on"
      : legacy === false
        ? "off"
        : "auto";
}
export function needsWeb(question: string, mode: WebMode): boolean {
  if (mode === "off") return false;
  if (mode === "on") return true;
  if (
    /\[hidden|\b(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)|localhost|\.local\b/i.test(
      question,
    )
  )
    return false;
  const explicit = /\b(search|look up|browse|research)\b/i.test(question);
  if (!explicit && /\b(my|our|mine|we|me|I)\b/i.test(question)) return false;
  return (
    explicit ||
    /\b(latest|today|current|recent|news|prices?|weather|forecast|midterms?|elections?|president|prime minister|who won|scores?|release date|right now|this week|when (?:is|are|will)|who is)\b/i.test(
      question,
    )
  );
}
export function clockContext(
  zone: unknown,
  now = new Date(),
): { iso: string; zone: string; date: string } {
  let tz = typeof zone === "string" ? zone : "UTC";
  try {
    return {
      iso: now.toISOString(),
      zone: tz,
      date: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: tz }).format(now),
    };
  } catch {
    tz = "UTC";
    return { iso: now.toISOString(), zone: tz, date: now.toISOString().slice(0, 10) };
  }
}
