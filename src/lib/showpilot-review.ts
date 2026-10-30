import type { EventEntry, EventRow, TaskNote } from "./work-tools";

export type Change<T> = { action: "replace"; value: T } | { action: "remove" };
export type Added<T> = { id: string; value: T };
export type ReviewDraft = {
  version: 1;
  entries: Record<string, Change<EventEntry>>;
  addedEntries: Added<EventEntry>[];
  tasks: Record<string, Change<TaskNote>>;
  addedTasks: Added<TaskNote>[];
};
export type ReviewLine<T> = {
  id: string;
  source: T | null;
  final: T | null;
  status: "unchanged" | "edited" | "removed" | "added";
};
export type ReviewResult = {
  entries: EventEntry[];
  tasks: TaskNote[];
  entryLines: ReviewLine<EventEntry>[];
  taskLines: ReviewLine<TaskNote>[];
  unmatchedChanges: number;
};

export const emptyReviewDraft = (): ReviewDraft => ({
  version: 1, entries: {}, addedEntries: [], tasks: {}, addedTasks: [],
});

// Deterministic, occurrence-aware IDs. The original source entry is never mutated.
export function keyedProposals<T>(items: readonly T[]): { id: string; source: T }[] {
  const occurrences = new Map<string, number>();
  return items.map((source) => {
    const key = JSON.stringify(source);
    const n = occurrences.get(key) ?? 0;
    occurrences.set(key, n + 1);
    return { id: key + "#" + n, source };
  });
}

function applyLines<T>(proposals: readonly T[], changes: Record<string, Change<T>>, added: readonly Added<T>[]): ReviewLine<T>[] {
  const lines: ReviewLine<T>[] = keyedProposals(proposals).map(({ id, source }) => {
    const change = changes[id];
    if (!change) return { id, source, final: source, status: "unchanged" };
    if (change.action === "remove") return { id, source, final: null, status: "removed" };
    return { id, source, final: change.value, status: JSON.stringify(source) === JSON.stringify(change.value) ? "unchanged" : "edited" };
  });
  for (const row of added) lines.push({ id: row.id, source: null, final: row.value, status: "added" });
  return lines;
}
export function validEntry(e: EventEntry): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date + "T12:00:00Z"))) return false;
  if (!e.title.trim() || !e.space.trim() || /(?:\bCEPAC\b|Cobb Energy|performing arts)/i.test(e.space)) return false;
  if (!["S","MI","Exmi","MO","MO?","Arr","Breakfast","Lunch","Dinner","Food","MTG"].includes(e.code)) return false;
  return Number.isFinite(e.start) && Number.isFinite(e.end) && e.start >= 0 && e.end > e.start && e.end <= 2880;
}

export function applyReview(proposed: readonly EventEntry[], suggestedTasks: readonly TaskNote[], draft: ReviewDraft): ReviewResult {
  const entryLines = applyLines(proposed, draft.entries, draft.addedEntries);
  const taskLines = applyLines(suggestedTasks, draft.tasks, draft.addedTasks);
  // Strict validity protects export from malformed project files and impossible times.
  // Never discard an imported suggestion just because older parser rules produced an unusual time.
  // Strict validation applies to user-created or edited entries; original source remains preserved.
  const entries = entryLines.flatMap((line) => line.final && (line.status === "unchanged" || validEntry(line.final)) ? [{ ...line.final }] : []);
  const tasks = taskLines.flatMap((line) => line.final && /^\d{4}-\d{2}-\d{2}$/.test(line.final.date) &&
    (line.final.section === "HALLS" || line.final.section === "BALLROOM") && line.final.text.trim()
      ? [{ ...line.final }] : []);
  const known = new Set([...keyedProposals(proposed).map((p) => p.id), ...keyedProposals(suggestedTasks).map((p) => p.id)]);
  const unmatchedChanges = [...Object.keys(draft.entries), ...Object.keys(draft.tasks)].filter((id) => !known.has(id)).length;
  return { entries, tasks, entryLines, taskLines, unmatchedChanges };
}

// Never carry edits to an unrelated report: IDs are scoped to a fingerprint of its raw functions.
export function fingerprintRows(rows: readonly EventRow[]): string {
  let h = 2166136261;
  const add = (s: string) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const r of rows) add(JSON.stringify([r.date, r.space, r.eventId, r.event, r.description, r.start, r.end, r.status, r.usage]) + "\n");
  return rows.length.toString(36) + "-" + (h >>> 0).toString(36);
}

const MAX_DRAFT = 1_200_000;
export function parseDraft(input: string): ReviewDraft {
  if (input.length > MAX_DRAFT) throw new Error("Review draft is too large.");
  const v: unknown = JSON.parse(input);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid review draft.");
  const obj = v as Record<string, unknown>;
  if (obj.version !== 1 || !obj.entries || !obj.tasks || !Array.isArray(obj.addedEntries) || !Array.isArray(obj.addedTasks)) {
    throw new Error("Unsupported review draft.");
  }
  const validateChanges = <T>(item: unknown): Record<string, Change<T>> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid review changes.");
    const result: Record<string, Change<T>> = Object.create(null) as Record<string, Change<T>>;
    for (const [id, change] of Object.entries(item)) {
      if (id.length > 1500 || !change || typeof change !== "object") throw new Error("Invalid change.");
      const c = change as Record<string, unknown>;
      if (c.action === "remove") result[id] = { action: "remove" };
      else if (c.action === "replace" && c.value && typeof c.value === "object") result[id] = { action: "replace", value: c.value as T };
      else throw new Error("Invalid change operation.");
    }
    return result;
  };
  const validAdded = <T>(item: unknown): Added<T>[] => {
    if (!Array.isArray(item) || item.length > 5000) throw new Error("Invalid added entries.");
    return item.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error("Invalid added entry.");
      const r = row as Record<string, unknown>;
      if (typeof r.id !== "string" || r.id.length > 120 || !r.value || typeof r.value !== "object") throw new Error("Invalid added entry.");
      return { id: r.id, value: r.value as T };
    });
  };
  return {
    version: 1, entries: validateChanges<EventEntry>(obj.entries), tasks: validateChanges<TaskNote>(obj.tasks),
    addedEntries: validAdded<EventEntry>(obj.addedEntries), addedTasks: validAdded<TaskNote>(obj.addedTasks),
  };
}

export function storageKey(fingerprint: string): string {
  return "showpilot:review:v1:" + fingerprint.replace(/[^a-z0-9-]/gi, "").slice(0, 42);
}

export type ReviewProject = {
  kind: "showpilot-review-project";
  version: 1;
  originalRows: EventRow[];
  draft: ReviewDraft;
  approvedSpaces: string[];
  includePending: boolean;
  note: string;
};

export function parseReviewProject(text: string): ReviewProject {
  if (text.length > 16_000_000) throw new Error("Project exceeds 16 MB.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Invalid project.");
  const p = value as Record<string, unknown>;
  if (p.kind !== "showpilot-review-project" || p.version !== 1 || !Array.isArray(p.originalRows) ||
      p.originalRows.length > 100000 || !Array.isArray(p.approvedSpaces)) throw new Error("Not a ShowPilot review project.");
  for (const r of p.originalRows) if (!r || typeof r !== "object" || typeof r.date !== "string" ||
     typeof r.space !== "string" || typeof r.description !== "string") throw new Error("Invalid source row.");
  const approvedSpaces = p.approvedSpaces.filter((s): s is string => typeof s === "string" && s.length <= 250).slice(0, 500);
  return {
    kind: "showpilot-review-project", version: 1, originalRows: p.originalRows as EventRow[],
    draft: parseDraft(JSON.stringify(p.draft)), approvedSpaces,
    includePending: p.includePending === true, note: typeof p.note === "string" ? p.note.slice(0, 200) : "",
  };
}
