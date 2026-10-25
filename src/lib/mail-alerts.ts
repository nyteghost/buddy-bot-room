// Email alert rules: a rule matches a message when the sender fits (kind "from") or the subject/start of the body contains the words (kind "keyword").
export type AlertRule = { id: string; kind: "from" | "keyword"; value: string };
export type MailAlert = { id: string; folder: string; uid: number; from: string; subject: string; preview: string; spam: boolean; at: number };
export const MAX_RULES = 30;
export const DEFAULT_RULES: AlertRule[] = [{ id: "gskill", kind: "from", value: "@gskill.com" }];

export function parseRules(raw: unknown): AlertRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): AlertRule[] => {
    const o = r as Partial<AlertRule> | null;
    if (!o || typeof o.id !== "string" || (o.kind !== "from" && o.kind !== "keyword") || typeof o.value !== "string" || !o.value.trim()) return [];
    return [{ id: o.id.slice(0, 24), kind: o.kind, value: o.value.trim().slice(0, 80) }];
  }).slice(0, MAX_RULES);
}

/** "@gskill.com" matches anyone at gskill.com (or a subdomain); "boss@x.com" matches that address; "gskill" matches anywhere in the sender. */
export function senderMatches(value: string, fromHeader: string, fromAddr: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  const addr = fromAddr.toLowerCase();
  if (v.startsWith("@")) return addr.endsWith(v) || addr.endsWith(`.${v.slice(1)}`);
  return addr === v || fromHeader.toLowerCase().includes(v);
}

export function matchRules(rules: AlertRule[], m: { from: string; fromAddr: string; subject: string; text: string }): AlertRule | null {
  const hay = `${m.subject}\n${m.text.slice(0, 5000)}`.toLowerCase();
  for (const r of rules) {
    if (r.kind === "from" ? senderMatches(r.value, m.from, m.fromAddr) : hay.includes(r.value.toLowerCase())) return r;
  }
  return null;
}
