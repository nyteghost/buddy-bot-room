/** Pure helpers for the Obsidian vault link: which paths are allowed and how a note becomes a file name. */

/** A vault-relative path to a markdown note, or null if it could escape the vault or touch Obsidian's own folders. */
export function safeRel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.replace(/\\/g, "/").trim();
  if (!raw || raw.startsWith("/") || raw.includes("\0") || raw.length > 400) return null;
  const parts = raw.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) return null;
  return /\.md$/i.test(parts[parts.length - 1]!) ? parts.join("/") : null;
}

/** A file name Obsidian accepts, from a note title. */
export function fileNameFor(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|#^[\]\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return `${base || "Untitled"}.md`;
}

export const titleOf = (rel: string): string => (rel.split("/").pop() ?? rel).replace(/\.md$/i, "");

/** `Name.md`, or `Name 2.md`, `Name 3.md`… when that name is taken (compared without case). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const stem = name.replace(/\.md$/i, "");
  for (let n = 2; n < 1000; n++) if (!used.has(`${stem} ${n}.md`.toLowerCase())) return `${stem} ${n}.md`;
  return `${stem} ${Date.now()}.md`;
}

/** The folder part of a setting such as "Pixel Pals" or "Inbox/Pixel Pals"; empty when it isn't a safe folder. */
export function cleanFolder(input: unknown): string {
  if (typeof input !== "string") return "";
  const parts = input.replace(/\\/g, "/").split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p.startsWith(".") || /[\0:*?"<>|]/.test(p))) return "";
  return parts.join("/");
}
