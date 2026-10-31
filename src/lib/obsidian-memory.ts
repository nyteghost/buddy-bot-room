import type { Entry, Workbench } from "./workbench";
export type Vault = Pick<Workbench, "memories" | "pal" | "project">;
export function renderMemoryNote(w: Vault): string {
 const lines = ["# Pixel Pals Memory", "", "Edit the text of a memory in Obsidian, then import it in Pixel Pals.", "", "## Shared"];
 const row = (e: Entry) => "- " + e.text.replace(/[\r\n]/g, " ").slice(0, 400) + " <!-- pp:" + e.id + ":" + e.at + ":" + (e.pinned ? "1" : "0") + " -->";
 lines.push(...w.memories.map(row));
 for (const [key,items] of Object.entries(w.pal ?? {})) lines.push("", "## Pal: " + key, ...items.map(row));
 for (const [key,items] of Object.entries(w.project ?? {})) lines.push("", "## Project: " + key, ...items.map(row));
 return lines.join("\n") + "\n";
}
export function parseMemoryNote(markdown: string): Vault {
 if (markdown.length > 200000) throw Error("Memory note too large");
 const out: Vault = { memories: [], pal: {}, project: {} };
 let selected: Entry[] | null = null;
 for (const line of markdown.split(/\r?\n/)) {
  if (line === "## Shared") { selected = out.memories; continue; }
  if (line.startsWith("## Pal: ")) { const name = line.slice(8).trim(); selected = (out.pal ??= {})[name] = []; continue; }
  if (line.startsWith("## Project: ")) { const name = line.slice(12).trim(); selected = (out.project ??= {})[name] = []; continue; }
  if (!selected || !line.startsWith("- ")) continue;
  const marker = /<!-- pp:([^:>]+):(\d+):([01]) -->$/.exec(line);
  const text = line.slice(2).replace(/\s*<!-- pp:.*? -->$/, "").trim().slice(0, 400);
  if (text) selected.push({ id: marker?.[1] ?? crypto.randomUUID(), text, at: marker ? Number(marker[2]) : Date.now(), ...(marker?.[3] === "1" ? { pinned: true } : {}) });
  if (selected.length > 100) throw Error("Too many memories");
 }
 return out;
}