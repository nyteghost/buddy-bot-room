/**
 * Versioned data migrations with a safety net. One small runner serves both the server's data folder and the browser's saved settings.
 *
 * How it stays safe:
 *  1. Before a migration runs, the current contents of every key it declares are copied into the version record ("pending").
 *  2. If the migration throws, those keys are put back and the run stops there: the data stays at the old version and the app keeps working.
 *  3. If the process is killed in the middle (power cut, container stop), the "pending" record is still there at the next start;
 *     the keys are put back first, then the migration gets one more try. After two failed attempts it is skipped for good and reported,
 *     so a bad migration can never trap the app in a restart loop.
 *  4. Migrations only change keys they declare, and never delete anything they did not declare.
 */
export type KV = {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
};
export type Migration = {
  /** Strictly increasing whole numbers. Never renumber or reuse an id after release. */
  id: number;
  name: string;
  /** Every key `up` may change. Their old values are saved first and restored on failure. */
  keys: string[];
  up: (kv: KV) => Promise<void> | void;
};
export type HistoryEntry = { id: number; name: string; at: number; result: "ok" | "failed" | "rolled-back" | "skipped"; note?: string };
export type VersionRecord = {
  version: number;
  pending?: { id: number; startedAt: number; attempts: number; saved: Record<string, string | null> };
  /** Ids given up on after repeated failures; they are never retried automatically. */
  skipped: number[];
  history: HistoryEntry[];
};
export type MigrationReport = { from: number; to: number; ran: number[]; rolledBack: number[]; failed?: { id: number; name: string; error: string }; skipped: number[]; recovered?: number };

export const MAX_ATTEMPTS = 2;
const HISTORY_MAX = 50;

export function parseRecord(raw: string | null): VersionRecord {
  const empty: VersionRecord = { version: 0, skipped: [], history: [] };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<VersionRecord>;
    if (!v || typeof v !== "object") return empty;
    const pending = v.pending && typeof v.pending === "object" && Number.isInteger(v.pending.id) && v.pending.saved && typeof v.pending.saved === "object"
      ? { id: v.pending.id, startedAt: Number(v.pending.startedAt) || 0, attempts: Number(v.pending.attempts) || 1, saved: Object.fromEntries(Object.entries(v.pending.saved).filter(([, x]) => x === null || typeof x === "string")) as Record<string, string | null> }
      : undefined;
    return {
      version: Number.isInteger(v.version) && (v.version as number) >= 0 ? (v.version as number) : 0,
      ...(pending ? { pending } : {}),
      skipped: Array.isArray(v.skipped) ? v.skipped.filter((n): n is number => Number.isInteger(n)) : [],
      history: Array.isArray(v.history) ? v.history.filter((h): h is HistoryEntry => !!h && typeof h === "object" && Number.isInteger((h as HistoryEntry).id)).slice(-HISTORY_MAX) : [],
    };
  } catch { return empty; }
}

/** Checks a migration list is usable (ids strictly increasing, positive). Throws a clear message otherwise. */
export function assertValid(list: Migration[]): void {
  let last = 0;
  for (const m of list) {
    if (!Number.isInteger(m.id) || m.id <= last) throw new Error(`Migration ids must be strictly increasing (got ${m.id} after ${last}).`);
    last = m.id;
  }
}

async function restore(kv: KV, saved: Record<string, string | null>): Promise<void> {
  for (const [k, v] of Object.entries(saved)) { if (v === null) await kv.remove(k); else await kv.set(k, v); }
}

/** Runs every migration newer than the recorded version, in order. `recordKey` is where the version record lives. Never throws for a migration problem. */
export async function runMigrations(kv: KV, list: Migration[], recordKey: string, now: () => number = Date.now): Promise<MigrationReport> {
  assertValid(list);
  const rec = parseRecord(await kv.get(recordKey));
  const report: MigrationReport = { from: rec.version, to: rec.version, ran: [], rolledBack: [], skipped: [...rec.skipped] };
  const save = async () => { rec.history = rec.history.slice(-HISTORY_MAX); await kv.set(recordKey, JSON.stringify(rec)); };
  const note = (m: Migration, result: HistoryEntry["result"], text?: string) => { rec.history.push({ id: m.id, name: m.name, at: now(), result, ...(text ? { note: text.slice(0, 200) } : {}) }); };

  // A previous run was cut off in the middle: put the keys back before doing anything else.
  let attempts = 0;
  if (rec.pending) {
    const p = rec.pending;
    await restore(kv, p.saved);
    const m = list.find((x) => x.id === p.id);
    report.rolledBack.push(p.id);
    report.recovered = p.id;
    attempts = p.attempts;
    if (m) note(m, "rolled-back", "interrupted; previous values restored");
    delete rec.pending;
    if (p.attempts >= MAX_ATTEMPTS && !rec.skipped.includes(p.id)) {
      rec.skipped.push(p.id);
      report.skipped.push(p.id);
      if (m) note(m, "skipped", `gave up after ${p.attempts} interrupted attempts`);
    }
    await save();
  }

  for (const m of list) {
    if (m.id <= rec.version) continue;
    if (rec.skipped.includes(m.id)) break; // later migrations may rely on this one
    const saved: Record<string, string | null> = {};
    for (const k of m.keys) saved[k] = await kv.get(k);
    const attempt = m.id === report.recovered ? attempts + 1 : 1;
    rec.pending = { id: m.id, startedAt: now(), attempts: attempt, saved };
    await save();
    try {
      await m.up(kv);
      delete rec.pending;
      rec.version = m.id;
      note(m, "ok");
      report.ran.push(m.id);
      await save();
    } catch (e) {
      const message = e instanceof Error ? e.message : "failed";
      try { await restore(kv, saved); } catch { /* the pending record still holds the values for the next start */ }
      delete rec.pending;
      note(m, "failed", message);
      report.rolledBack.push(m.id);
      report.failed = { id: m.id, name: m.name, error: message.slice(0, 200) };
      await save();
      break;
    }
  }
  report.to = rec.version;
  return report;
}

/** One line for the status screen. */
export function migrationText(report: MigrationReport | null, rec: VersionRecord): string {
  if (report?.failed) return `Data format v${rec.version}. Migration ${report.failed.id} (${report.failed.name}) failed and was undone: ${report.failed.error}`;
  if (rec.skipped.length) return `Data format v${rec.version}. Skipped migration${rec.skipped.length > 1 ? "s" : ""} ${rec.skipped.join(", ")} after repeated interruptions.`;
  if (report?.recovered) return `Data format v${rec.version}. A migration was interrupted last time; its files were restored.`;
  return `Data format v${rec.version}.`;
}
