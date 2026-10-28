/** Unsent Mail text stays in the current browser tab only.
 * Session storage survives refresh but is cleared when the tab/session ends.
 * Never put drafts in server logs or a shared persistent account snapshot. */
export type MailDraft = { to: string; cc: string; subject: string; text: string; inReplyTo: string; references: string };
const PREFIX = "pixelpals:mail-draft-v1:";
const LIMITS: Record<keyof MailDraft, number> = {
  to: 2000, cc: 2000, subject: 500, text: 100_000, inReplyTo: 2000, references: 3000,
};
export const blankMailDraft = (): MailDraft => ({ to: "", cc: "", subject: "", text: "", inReplyTo: "", references: "" });
export const hasMailDraft = (draft: MailDraft): boolean =>
  Object.values(draft).some((value) => value.trim().length > 0);

export function mailDraftKey(account: string | null | undefined): string | null {
  const clean = (account ?? "").trim().toLowerCase();
  if (!clean || clean.length > 250) return null;
  return PREFIX + encodeURIComponent(clean);
}

export function parseMailDraft(raw: string | null): MailDraft | null {
  if (!raw || raw.length > 120_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const result = blankMailDraft();
    for (const [field, max] of Object.entries(LIMITS) as [keyof MailDraft, number][]) {
      if (typeof obj[field] !== "string" || obj[field].length > max) return null;
      result[field] = obj[field];
    }
    return hasMailDraft(result) ? result : null;
  } catch { return null; }
}

export function readMailDraft(store: Pick<Storage, "getItem">, account: string | null | undefined): MailDraft | null {
  const key = mailDraftKey(account);
  if (!key) return null;
  try { return parseMailDraft(store.getItem(key)); } catch { return null; }
}

export function writeMailDraft(store: Pick<Storage, "setItem" | "removeItem">, account: string | null | undefined, draft: MailDraft | null): boolean {
  const key = mailDraftKey(account);
  if (!key) return false;
  try {
    if (!draft || !hasMailDraft(draft)) store.removeItem(key);
    else {
      const raw = JSON.stringify(draft);
      if (!parseMailDraft(raw)) return false;
      store.setItem(key, raw);
    }
    return true;
  } catch { return false; }
}
