/**
 * Export / import everything the app keeps in this browser as one JSON file.
 * Matters most for self-hosted "Local mode", where nothing syncs to an account.
 */
export const BACKUP_VERSION = 1;
/** Only these keys are ever written back on import — nothing else in storage can be touched by a backup file. */
export const BACKUP_KEYS = [
  "pixel-pals-engine-v1",
  "pixel-pals-workbench-v1",
  "pixel-pals-presets-v1",
  "pixel-pals-chatmeta-v1",
  "pixel-pals-agent-notes-v1",
  "pixel-pals-compare-v1",
  "pixel-pals-saved-discussions-v1",
  "pixel-pals-docs-v1",
  "pixel-pals-campaign-v1",
  "pixel-pals-workspace-v1",
  "pixel-pals-voice-v1",
  "pixel-pals-smart-v1",
  "pixel-pals-characters-v1",
  "pixel-pals-projects-v1",
] as const;
/** Keys that follow a signed-in account on the self-hosted build. Saved chats are excluded: the server store handles those. */
export const SYNC_JSON_KEYS: readonly string[] = BACKUP_KEYS.filter((k) => k !== "pixel-pals-saved-discussions-v1");
/** Small plain-string settings (theme, assistant switch, local model, notes folder). */
export const SYNC_PLAIN_KEYS: readonly string[] = ["pixel-pals-character-mode-v1", "pixel-pals-assistant-mode-v1", "pixel-pals-local-model-v1", "pixel-pals-notes-dir-v1", "pixel-pals-autosearch-v1", "pixel-pals-appearance-v1", "pixel-pals-active-project-v1"];
export const SYNC_KEYS: readonly string[] = [...SYNC_JSON_KEYS, ...SYNC_PLAIN_KEYS];
export const SYNC_MAX_BYTES = 1_800_000;

/** Validates a settings snapshot from the browser. Unknown keys, bad JSON and oversize snapshots are rejected. */
export function validSyncData(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  let total = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!SYNC_KEYS.includes(k) || typeof val !== "string") return null;
    if (SYNC_PLAIN_KEYS.includes(k)) { if (val.length > 300) return null; }
    else { try { JSON.parse(val); } catch { return null; } }
    total += k.length + val.length;
    if (total > SYNC_MAX_BYTES) return null;
    out[k] = val;
  }
  return out;
}

const SECRET_FIELDS = ["groqKey", "geminiKey", "openrouterKey", "nvidiaKey", "anthropicKey", "customKey"];
const MAX_BYTES = 8_000_000;

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export type Backup = { app: "pixel-pals"; version: number; exportedAt: string; includesKeys: boolean; data: Record<string, string> };

export function buildBackup(storage: StorageLike, includeKeys: boolean, now = new Date()): Backup {
  const data: Record<string, string> = {};
  for (const k of BACKUP_KEYS) {
    let v = storage.getItem(k);
    if (v === null) continue;
    if (k === "pixel-pals-engine-v1" && !includeKeys) {
      try {
        const o = JSON.parse(v) as Record<string, unknown>;
        for (const f of SECRET_FIELDS) o[f] = "";
        v = JSON.stringify(o);
      } catch { continue; }
    }
    data[k] = v;
  }
  return { app: "pixel-pals", version: BACKUP_VERSION, exportedAt: now.toISOString(), includesKeys: includeKeys, data };
}

export type ImportResult = { ok: true; restored: string[]; skipped: string[] } | { ok: false; error: string };

/** Validates before touching storage. A backup without keys never blanks keys you already have. */
export function applyBackup(storage: StorageLike, json: string): ImportResult {
  if (json.length > MAX_BYTES) return { ok: false, error: "That file is too large to be a Pixel Pals backup." };
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { ok: false, error: "That isn't a valid JSON file." }; }
  const b = parsed as Partial<Backup> | null;
  if (!b || b.app !== "pixel-pals" || typeof b.version !== "number" || !b.data || typeof b.data !== "object") return { ok: false, error: "That isn't a Pixel Pals backup file." };
  if (b.version > BACKUP_VERSION) return { ok: false, error: "This backup comes from a newer version of Pixel Pals." };
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(b.data)) {
    if (!(BACKUP_KEYS as readonly string[]).includes(k) || typeof v !== "string") { skipped.push(k); continue; }
    try { JSON.parse(v); } catch { skipped.push(k); continue; }
    let value = v;
    if (k === "pixel-pals-engine-v1" && b.includesKeys !== true) {
      try {
        const incoming = JSON.parse(v) as Record<string, unknown>;
        const current = JSON.parse(storage.getItem(k) ?? "{}") as Record<string, unknown>;
        for (const f of SECRET_FIELDS) incoming[f] = typeof current[f] === "string" ? current[f] : "";
        value = JSON.stringify(incoming);
      } catch { skipped.push(k); continue; }
    }
    try { storage.setItem(k, value); restored.push(k); } catch { skipped.push(k); }
  }
  return restored.length ? { ok: true, restored, skipped } : { ok: false, error: "The backup had nothing this version can restore." };
}
