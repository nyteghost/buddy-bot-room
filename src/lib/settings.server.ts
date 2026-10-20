import { currentUser } from "./accounts.server";
import { SETTING_FIELDS, cleanSetting, envValue, fieldByKey, type SettingState } from "./settings";
import { logServer } from "./server-log.server";

/**
 * In-app settings. Values are saved in BUDDY_DATA_DIR and laid over process.env, so every module that
 * already reads process.env picks them up with no changes. A real environment variable always wins.
 * Secrets go in app-secrets.json (mode 600), which backups skip and the browser never receives.
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
export const SETTINGS_FILE = "app-settings.json";
export const SECRETS_FILE = "app-secrets.json";

type Store = { values: Record<string, string>; secrets: Record<string, string> };
const holder = globalThis as unknown as { __buddySettings?: { original: Record<string, string>; store: Store; ready?: Promise<void> } };
const state = () => (holder.__buddySettings ??= { original: {}, store: { values: {}, secrets: {} } });

/** Which keys came from the real environment, captured once before anything is laid over it. */
function captureOriginal(): void {
  const s = state();
  if (Object.keys(s.original).length) return;
  for (const f of SETTING_FIELDS) s.original[f.key] = (process.env[f.key] ?? "").trim() ? "1" : "";
}
export const fromEnvironment = (key: string): boolean => { captureOriginal(); return state().original[key] === "1"; };

async function readJson(name: string): Promise<Record<string, string>> {
  if (!dir()) return {};
  try {
    const raw = JSON.parse(await (await fs()).readFile(`${dir()}/${name}`, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (fieldByKey(k) && typeof v === "string") out[k] = v;
    return out;
  } catch { return {}; }
}
async function writeJson(name: string, data: Record<string, string>, secret: boolean): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  const path = `${dir()}/${name}`;
  await f.writeFile(`${path}.tmp`, JSON.stringify(data, null, 2), { encoding: "utf8", mode: secret ? 0o600 : 0o644 });
  await f.rename(`${path}.tmp`, path);
}

/** Lay the saved settings over the environment (never over a value that came from the real environment). */
function apply(): void {
  captureOriginal();
  const { store, original } = state();
  for (const f of SETTING_FIELDS) {
    if (original[f.key] === "1") continue;
    const stored = (f.secret ? store.secrets[f.key] : store.values[f.key]) ?? "";
    if (stored) process.env[f.key] = envValue(f.key, stored);
    else delete process.env[f.key];
  }
}

/** Load once at start. Safe to call on every request. */
export function ensureSettings(): Promise<void> {
  const s = state();
  s.ready ??= (async () => {
    captureOriginal();
    s.store = { values: await readJson(SETTINGS_FILE), secrets: await readJson(SECRETS_FILE) };
    apply();
  })();
  return s.ready;
}

export async function describeSettings(): Promise<SettingState[]> {
  await ensureSettings();
  const { store } = state();
  return SETTING_FIELDS.map((f) => {
    const saved = (f.secret ? store.secrets[f.key] : store.values[f.key]) ?? "";
    const source: SettingState["source"] = fromEnvironment(f.key) ? "env" : saved ? "app" : "none";
    const base = { key: f.key, label: f.label, group: f.group, kind: f.kind, secret: !!f.secret, options: f.options, placeholder: f.placeholder, help: f.help, source };
    return !f.secret && source === "app" ? { ...base, value: saved } : base;
  });
}

let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

/** Save changes. A value of null or "" clears it. Returns an error per key that was refused; the rest are saved. */
export async function saveSettings(changes: Record<string, unknown>): Promise<{ saved: string[]; errors: Record<string, string> }> {
  await ensureSettings();
  return locked(async () => {
    const errors: Record<string, string> = {};
    const saved: string[] = [];
    if (!dir()) return { saved, errors: { _: "Saving needs BUDDY_DATA_DIR (the Docker stack sets it)." } };
    const values = { ...state().store.values };
    const secrets = { ...state().store.secrets };
    for (const [key, raw] of Object.entries(changes)) {
      const field = fieldByKey(key);
      if (!field) { errors[key] = "Unknown setting."; continue; }
      if (fromEnvironment(key)) { errors[key] = `${field.label} is set in Portainer. Change or remove it there.`; continue; }
      const clean = raw === null ? ({ ok: true, value: "" } as const) : cleanSetting(field, raw);
      if (!clean.ok) { errors[key] = clean.error; continue; }
      const target = field.secret ? secrets : values;
      if (clean.value) target[key] = clean.value; else delete target[key];
      saved.push(key);
    }
    if (saved.length) {
      await writeJson(SETTINGS_FILE, values, false);
      await writeJson(SECRETS_FILE, secrets, true);
      state().store = { values, secrets };
      apply();
      logServer("info", `Settings saved in the app: ${saved.join(", ")}`);
      await restartAfter(saved);
    }
    return { saved, errors };
  });
}

/** Things that read their settings once (timers, the bot) get a nudge so changes take effect without a redeploy. */
async function restartAfter(keys: string[]): Promise<void> {
  try {
    if (keys.some((k) => k.startsWith("UNRAID_"))) (await import("./unraid.server")).restartWatcher();
    if (keys.some((k) => k.startsWith("TELEGRAM_"))) (await import("./telegram.server")).startTelegram();
    if (keys.some((k) => ["BRIEF_TIME", "REVIEW_DAY", "REVIEW_TIME", "BUDDY_BACKUP_TIME", "BUDDY_BACKUP_KEEP", "BUDDY_TZ"].includes(k))) (await import("./scheduler.server")).startScheduler();
  } catch (error) { logServer("warn", "Couldn't restart a background job after saving settings", error); }
}

/** GET lists every setting (secrets are never returned); POST { values: { KEY: "text" | null } } saves. Owner only. */
export async function handleSettings(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can change settings." }, { status: 403 });
  let result: { saved: string[]; errors: Record<string, string> } | null = null;
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { values?: Record<string, unknown> };
    if (!body.values || typeof body.values !== "object") return Response.json({ error: "Nothing to save." }, { status: 400 });
    result = await saveSettings(body.values);
  }
  return Response.json({ settings: await describeSettings(), ...(result ?? {}) });
}
