/**
 * Compare an iOS Note (plain text, one title per line) with Trakt. Read-only on Trakt.
 * Trakt wins: a title Trakt says you watched gets a ✓ in the note; a ✓ you typed that Trakt doesn't know about is kept and flagged.
 * Shows are only ever marked "started" (▶), never finished, because "finished" needs per-episode progress.
 */
export type Kind = "movie" | "show";
export type Candidate = { title: string; year?: number; kind: Kind; id?: number };
export type PoolItem = Candidate & { onList: boolean; watched: boolean; started: boolean };
export type NoteLine = { raw: string; item: boolean; bullet: string; box: boolean; marked: boolean; started: boolean; text: string; title: string; year?: number };
export type Status = "skip" | "watched" | "already" | "started" | "ontrakt" | "found" | "ambiguous" | "nomatch" | "conflict";
export type LineResult = { index: number; status: Status; raw: string; text: string; newRaw: string; match?: Candidate; options?: string[] };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function norm(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(the|a|an) /, "");
}

const BULLET = /^(\s*(?:[-*•–]\s+|\d{1,3}[.)]\s+)?)/;
const BOX = /^\[( |x|X|✓|✔)?\]\s*/;
const MARK = /^(?:✓|✔|☑️|☑|✅)\s*/;
const TAIL = /\s*(?:▶|✓|✔|✅)\s*$/;

export function parseNote(text: string, skip = 0): NoteLine[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((raw, i) => {
    const blank: NoteLine = { raw, item: false, bullet: "", box: false, marked: false, started: false, text: "", title: "" };
    const trimmed = raw.trim();
    if (i < skip || !trimmed || trimmed.endsWith(":") || trimmed.length > 90) return blank;
    const bullet = BULLET.exec(raw)?.[1] ?? "";
    let rest = raw.slice(bullet.length);
    let marked = false;
    let box = false;
    const b = BOX.exec(rest);
    if (b) { box = true; marked = ["x", "X", "✓", "✔"].includes(b[1] ?? ""); rest = rest.slice(b[0].length); }
    const m = MARK.exec(rest);
    if (m) { marked = true; rest = rest.slice(m[0].length); }
    let started = false;
    for (let guard = 0; guard < 3; guard++) {
      const t = TAIL.exec(rest);
      if (!t) break;
      if (t[0].includes("▶")) started = true; else marked = true;
      rest = rest.slice(0, t.index);
    }
    const text2 = rest.trim();
    const y = /\s*\((\d{4})\)\s*$/.exec(text2);
    const title = (y ? text2.slice(0, y.index) : text2).trim();
    if (!title) return blank;
    return { raw, item: true, bullet, box, marked, started, text: text2, title, ...(y?.[1] ? { year: Number(y[1]) } : {}) };
  });
}

/** Re-render a line with the new state. Untouched when nothing changes, so repeated syncs are stable. */
function render(l: NoteLine, marked: boolean, started: boolean): string {
  if (marked === l.marked && started === l.started) return l.raw;
  const front = l.box ? `[${marked ? "x" : " "}] ` : marked ? "✓ " : "";
  return `${l.bullet}${front}${l.text}${started && !marked ? " ▶" : ""}`;
}

/** /users/:u/watched/movies or /watched/shows */
export function shapeHistory(json: unknown, kind: Kind): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of arr(json)) {
    const body = rec(rec(raw)[kind]);
    const title = str(body["title"]).trim();
    if (!title) continue;
    const c: Candidate = { title, kind };
    if (typeof body["year"] === "number") c.year = body["year"];
    const id = rec(body["ids"])["trakt"];
    if (typeof id === "number") c.id = id;
    out.push(c);
  }
  return out;
}

/** /search/movie,show results */
export function shapeSearch(json: unknown): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of arr(json)) {
    const type = str(rec(raw)["type"]);
    if (type !== "movie" && type !== "show") continue;
    const body = rec(rec(raw)[type]);
    const title = str(body["title"]).trim();
    if (!title) continue;
    const c: Candidate = { title, kind: type };
    if (typeof body["year"] === "number") c.year = body["year"];
    const id = rec(body["ids"])["trakt"];
    if (typeof id === "number") c.id = id;
    out.push(c);
  }
  return out;
}

const keyOf = (c: Candidate) => (c.id !== undefined ? `${c.kind}#${c.id}` : `${c.kind}:${norm(c.title)}:${c.year ?? ""}`);

/** Everything Trakt knows: the chosen list plus watch history. Movies in history are "watched"; shows are "started". */
export function buildPool(list: Candidate[], watchedMovies: Candidate[], watchedShows: Candidate[]): PoolItem[] {
  const pool = new Map<string, PoolItem>();
  const add = (c: Candidate, patch: Partial<Pick<PoolItem, "onList" | "watched" | "started">>) => {
    const k = keyOf(c);
    const cur = pool.get(k) ?? { ...c, onList: false, watched: false, started: false };
    pool.set(k, { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v)) });
  };
  for (const c of list) add(c, { onList: true });
  for (const c of watchedMovies) add(c, { watched: true });
  for (const c of watchedShows) add(c, { started: true });
  return [...pool.values()];
}

function titleMatches<T extends Candidate>(line: NoteLine, items: T[]): T[] {
  const n = norm(line.title);
  return items.filter((c) => norm(c.title) === n && (line.year === undefined || c.year === line.year));
}

function pickFromPool(line: NoteLine, pool: PoolItem[]): { item?: PoolItem; ambiguous?: PoolItem[] } {
  const hits = titleMatches(line, pool);
  if (hits.length <= 1) return hits[0] ? { item: hits[0] } : {};
  const onList = hits.filter((h) => h.onList);
  if (onList.length === 1 && onList[0]) return { item: onList[0] };
  return { ambiguous: hits };
}

/** Lines Trakt's own data couldn't place; the server asks Trakt's search about these (capped). */
export function needsSearch(lines: NoteLine[], pool: PoolItem[]): NoteLine[] {
  return lines.filter((l) => {
    if (!l.item) return false;
    const p = pickFromPool(l, pool);
    return !p.item && !p.ambiguous;
  });
}
export const searchKey = (l: Pick<NoteLine, "title" | "year">): string => `${norm(l.title)}|${l.year ?? ""}`;

const label = (c: Candidate) => `${c.title}${c.year ? ` (${c.year})` : ""}${c.kind === "show" ? " [show]" : ""}`;

export function decide(lines: NoteLine[], pool: PoolItem[], searched: Map<string, Candidate[]>): LineResult[] {
  return lines.map((l, index): LineResult => {
    const base = { index, raw: l.raw, text: l.text || l.raw.trim(), newRaw: l.raw };
    if (!l.item) return { ...base, status: "skip" };
    const p = pickFromPool(l, pool);
    if (p.ambiguous) return { ...base, status: "ambiguous", options: p.ambiguous.slice(0, 4).map(label) };
    if (p.item) {
      const m = p.item;
      if (m.kind === "movie" && m.watched) return { ...base, status: l.marked ? "already" : "watched", match: m, newRaw: render(l, true, false) };
      if (m.kind === "show" && m.started && !m.watched) return { ...base, status: l.marked ? "conflict" : "started", match: m, newRaw: l.marked ? l.raw : render(l, false, true) };
      return { ...base, status: l.marked ? "conflict" : "ontrakt", match: m, newRaw: l.marked ? l.raw : render(l, false, false) };
    }
    const found = titleMatches(l, searched.get(searchKey(l)) ?? []);
    const distinct = new Map(found.map((c) => [keyOf(c), c]));
    if (distinct.size === 1) return { ...base, status: l.marked ? "conflict" : "found", match: [...distinct.values()][0] as Candidate };
    if (distinct.size > 1) return { ...base, status: "ambiguous", options: [...distinct.values()].slice(0, 4).map(label) };
    return { ...base, status: l.marked ? "already" : "nomatch" };
  });
}

/** Titles on the Trakt list that no note line mentions. */
export function missingFromNote(lines: NoteLine[], pool: PoolItem[]): Candidate[] {
  const keys = new Set(lines.filter((l) => l.item).map((l) => norm(l.title)));
  return pool.filter((p) => p.onList && !keys.has(norm(p.title)));
}

export function buildReport(results: LineResult[], missing: Candidate[], meta: { date: string; list: string; historyOk: boolean }): string {
  const by = (s: Status) => results.filter((r) => r.status === s);
  const name = (r: LineResult) => (r.match ? label(r.match) : r.text);
  const out: string[] = [`Synced with Trakt on ${meta.date} (list: ${meta.list})`];
  if (!meta.historyOk) out.push("⚠ Couldn't read your Trakt watch history (is your profile public?), so nothing was marked watched.");
  const section = (title: string, rows: string[]) => { if (rows.length) out.push("", `${title}:`, ...rows.map((r) => `• ${r}`)); };
  section("✓ Newly marked watched", by("watched").map(name));
  section("▶ Started (shows)", by("started").map(name));
  section("Marked ✓ in the note but Trakt shows no watch (kept your ✓)", by("conflict").map(name));
  section("On Trakt but not on your list", by("found").map(name));
  section("Not sure which one you mean (add the year, e.g. “Dune (2021)”)", by("ambiguous").map((r) => `${r.text} → ${(r.options ?? []).join(" / ")}`));
  section("Couldn't find on Trakt", by("nomatch").map((r) => r.text));
  section("On your Trakt list but not in the note", missing.slice(0, 20).map(label));
  if (out.length === 1) out.push("", "Everything already matches.");
  return out.join("\n");
}

export function counts(results: LineResult[]): Record<Status, number> {
  const c: Record<Status, number> = { skip: 0, watched: 0, already: 0, started: 0, ontrakt: 0, found: 0, ambiguous: 0, nomatch: 0, conflict: 0 };
  for (const r of results) c[r.status]++;
  return c;
}
