// Where a viewed document comes from. One adapter so Mail attachments, uploaded files and (later) Projects or chat attachments
// all open the same way. Bytes only ever live in memory in the browser tab.
import { attachmentKind, type AttachmentKind } from "../mailbox";
import { PDF_MAX_BYTES } from "./pdf-model";
import { SHEET_MAX_BYTES } from "./sheet-model";

export type DocSource =
  | { kind: "mail"; folder: string; uid: number; index: number; name: string; size?: number }
  | { kind: "file"; file: File };

export const sourceName = (s: DocSource): string => (s.kind === "file" ? s.file.name : s.name);
export const sourceKind = (s: DocSource): AttachmentKind => attachmentKind(sourceName(s), s.kind === "file" ? s.file.type : "");
export const maxBytesFor = (k: AttachmentKind): number => (k === "pdf" ? PDF_MAX_BYTES : SHEET_MAX_BYTES);
export const sourceKey = (s: DocSource): string => (s.kind === "mail" ? `mail:${s.folder}:${s.uid}:${s.index}` : `file:${s.file.name}:${s.file.size}:${s.file.lastModified}`);

/** The authenticated, owner-only address of a mail attachment. `download` forces a save instead of showing it. */
export const mailAttachmentUrl = (s: Extract<DocSource, { kind: "mail" }>, download = false): string =>
  `/api/mailbox?op=attachment&folder=${encodeURIComponent(s.folder)}&uid=${s.uid}&index=${s.index}${download ? "&download=1" : ""}`;

export const humanSize = (n: number): string => (n < 0 ? "" : n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

/** Reads the document's bytes. Refuses over-size files before reading them; reports server errors in plain words. */
export async function fetchSource(s: DocSource, signal?: AbortSignal): Promise<{ buffer: ArrayBuffer; name: string }> {
  const kind = sourceKind(s);
  const limit = maxBytesFor(kind);
  const tooBig = () => new Error(`This file is larger than ${Math.round(limit / 1_000_000)} MB, which is too large to open here. Download it instead.`);
  if (s.kind === "file") {
    if (s.file.size > limit) throw tooBig();
    return { buffer: await s.file.arrayBuffer(), name: s.file.name };
  }
  const res = await fetch(mailAttachmentUrl(s), signal ? { credentials: "same-origin", signal } : { credentials: "same-origin" });
  if (!res.ok) {
    let msg = "Couldn't load the attachment.";
    try { const j = (await res.json()) as { error?: string }; if (j.error) msg = j.error; } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > limit) throw tooBig();
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > limit) throw tooBig();
  return { buffer, name: s.name };
}

/** Saves bytes you already have as a file, without sending them anywhere. */
export function saveBytes(buffer: ArrayBuffer, name: string, type = "application/octet-stream"): void {
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 150) || "file";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
