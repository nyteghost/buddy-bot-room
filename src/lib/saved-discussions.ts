import type { RoomMessage, Mode } from "./agents";
import { isCharacterMode, type CharacterMode } from "./hellraiser";

export type SavedDiscussion = { id: string; title: string; messages: RoomMessage[]; theme: CharacterMode; mode: Mode; updatedAt: string; /** Set by the server when accounts are on. */ mine?: boolean; ownerName?: string; shared?: boolean };
export const savedDiscussionsKey = "pixel-pals-saved-discussions-v1";
export function readDiscussions(): SavedDiscussion[] {
  const raw = localStorage.getItem(savedDiscussionsKey);
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.every(row => row && typeof row.id === "string" && typeof row.title === "string" && typeof row.updatedAt === "string" && isCharacterMode(row.theme) && ["roundtable", "broadcast", "direct", "solve"].includes(row.mode) && Array.isArray(row.messages) && row.messages.every((m: RoomMessage) => m && typeof m.id === "string" && ["user", "assistant", "system"].includes(m.role) && Array.isArray(m.parts)))) {
    throw new Error("Saved discussions could not be read. Existing data has not been changed.");
  }
  return rows;
}
export function writeDiscussions(rows: SavedDiscussion[]) {
  try { localStorage.setItem(savedDiscussionsKey, JSON.stringify(rows)); }
  catch { throw new Error("Browser storage is full or unavailable. Download a copy before clearing anything."); }
}import { messageText } from "./agents";
/** Title for an auto-saved chat: the first thing the user typed. */
export function chatTitle(messages: RoomMessage[]): string {
  const first = messages.find((m) => m.role === "user") ?? messages[0];
  return (first ? messageText(first).trim().slice(0, 120) : "") || "Untitled chat";
}
