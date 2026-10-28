// "Recent documents": only names and sizes are remembered (in this browser), never file contents. Mail attachments can be re-fetched, local files
// must be chosen again after a reload.
import type { AttachmentKind } from "../mailbox";

export type RecentDoc =
  | { id: string; kind: AttachmentKind; name: string; size: number; at: number; origin: "mail"; folder: string; uid: number; index: number }
  | { id: string; kind: AttachmentKind; name: string; size: number; at: number; origin: "local" };

export const RECENT_KEY = "pixel-pals-recent-docs-v1";
export const RECENT_MAX = 12;

/** Newest first, one entry per document, capped. */
export function addRecent(list: readonly RecentDoc[], doc: RecentDoc, max = RECENT_MAX): RecentDoc[] {
  return [doc, ...list.filter((d) => d.id !== doc.id)].slice(0, max);
}
export function removeRecent(list: readonly RecentDoc[], id: string): RecentDoc[] { return list.filter((d) => d.id !== id); }

/** Reads what was stored, ignoring anything malformed (the storage is user-editable). */
export function parseRecent(raw: string | null): RecentDoc[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const out: RecentDoc[] = [];
  for (const d of data) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const base = { id: String(o["id"] ?? "").slice(0, 300), name: String(o["name"] ?? "").slice(0, 200), size: Number.isFinite(Number(o["size"])) ? Math.max(-1, Math.floor(Number(o["size"]))) : -1, at: Number.isFinite(Number(o["at"])) ? Number(o["at"]) : 0 };
    const kind: AttachmentKind = o["kind"] === "pdf" || o["kind"] === "sheet" ? o["kind"] : "other";
    if (!base.id || !base.name) continue;
    if (o["origin"] === "mail" && typeof o["folder"] === "string" && Number.isInteger(o["uid"]) && Number.isInteger(o["index"])) out.push({ ...base, kind, origin: "mail", folder: o["folder"].slice(0, 300), uid: o["uid"] as number, index: o["index"] as number });
    else if (o["origin"] === "local") out.push({ ...base, kind, origin: "local" });
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** Adds a document to the stored recent list (browser only; silently does nothing if storage is unavailable). */
export function rememberRecent(doc: RecentDoc): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(addRecent(parseRecent(localStorage.getItem(RECENT_KEY)), doc))); } catch { /* storage unavailable */ }
}
