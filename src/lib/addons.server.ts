import { currentUser } from "./accounts.server";
import { BRIDGE_SCRIPT, PERMISSION_TEXT, parseManifest, type AddonInfo, type AddonManifest, type AddonPermission } from "./addons";
import { pushNotice } from "./schedules.server";
import { logServer } from "./server-log.server";

/**
 * Add-ons: folders in <data>/addons/<id>/ (addon.json + a server script + an optional window page).
 * They are OFF until the owner enables them in Settings, and a changed add-on is switched off again until re-approved.
 * IMPORTANT: add-on code runs inside the Pixel Pals server with the same access it has. Permissions control which helpers an add-on is
 * given and what the Settings screen shows you; they are not a sandbox. Only enable add-ons you trust. (The window page is sandboxed.)
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const addonsDir = () => `${dir()}/addons`;
const fsm = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const crypto_ = async () => (await import(/* @vite-ignore */ "node:" + "crypto")) as typeof import("node:crypto");
const stateFile = () => `${dir()}/addons-state.json`;

type Ctx = {
  log: (text: string) => void;
  notify: (title: string, text: string) => Promise<void>;
  storage: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> };
};
type Module = {
  commands?: Record<string, (args: string, ctx: Ctx) => unknown>;
  api?: Record<string, (args: unknown, ctx: Ctx) => unknown>;
  jobs?: Record<string, (ctx: Ctx) => unknown>;
};
type Found = { manifest: AddonManifest; hash: string } | { id: string; problems: string[] };
type State = { enabled: Record<string, string> }; // id -> hash that was approved

const mem = globalThis as unknown as { __addonMods?: Map<string, { hash: string; mod: Module }>; __addonRuns?: Map<string, number> };

async function readState(): Promise<State> {
  try { const j = JSON.parse(await (await fsm()).readFile(stateFile(), "utf8")) as State; return { enabled: j && typeof j.enabled === "object" && j.enabled ? j.enabled : {} }; } catch { return { enabled: {} }; }
}
async function writeState(s: State): Promise<void> {
  const f = await fsm();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${stateFile()}.tmp`, JSON.stringify(s), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${stateFile()}.tmp`, stateFile());
}

async function scan(): Promise<Found[]> {
  if (!dir()) return [];
  const f = await fsm();
  let names: string[] = [];
  try { names = (await f.readdir(addonsDir(), { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).slice(0, 50); } catch { return []; }
  const out: Found[] = [];
  for (const name of names) {
    try {
      const manifestText = await f.readFile(`${addonsDir()}/${name}/addon.json`, "utf8");
      const parsed = parseManifest(JSON.parse(manifestText), name);
      if (!parsed.ok) { out.push({ id: name, problems: parsed.problems }); continue; }
      const m = parsed.manifest;
      let mainText = "";
      try { mainText = await f.readFile(`${addonsDir()}/${name}/${m.main}`, "utf8"); } catch { /* an add-on may be window-only */ }
      let winText = "";
      if (m.window) { try { winText = await f.readFile(`${addonsDir()}/${name}/${m.window.entry}`, "utf8"); } catch { out.push({ id: name, problems: [`${m.window.entry} is missing`] }); continue; } }
      const hash = (await crypto_()).createHash("sha256").update(manifestText).update("\0").update(mainText).update("\0").update(winText).digest("hex").slice(0, 24);
      out.push({ manifest: m, hash });
    } catch (e) { out.push({ id: name, problems: [e instanceof SyntaxError ? "addon.json isn't valid JSON" : "addon.json is missing or unreadable"] }); }
  }
  return out;
}

export async function listAddons(): Promise<AddonInfo[]> {
  const [found, st] = await Promise.all([scan(), readState()]);
  return found.map((x): AddonInfo => {
    if ("problems" in x) return { id: x.id, name: x.id, version: "", description: "", author: "", permissions: [], permissionText: [], commands: [], jobs: [], enabled: false, changed: false, problems: x.problems };
    const m = x.manifest;
    const approved = st.enabled[m.id];
    return {
      id: m.id, name: m.name, version: m.version, description: m.description, author: m.author, permissions: m.permissions,
      permissionText: m.permissions.map((p) => PERMISSION_TEXT[p]),
      commands: m.commands, window: m.window ? { title: m.window.title } : undefined, jobs: m.jobs, enabled: approved === x.hash, changed: !!approved && approved !== x.hash, problems: [],
    };
  });
}

async function enabledFound(id: string): Promise<{ manifest: AddonManifest; hash: string } | null> {
  const [found, st] = await Promise.all([scan(), readState()]);
  const hit = found.find((x): x is { manifest: AddonManifest; hash: string } => "manifest" in x && x.manifest.id === id);
  return hit && st.enabled[id] === hit.hash ? hit : null;
}

async function context(m: AddonManifest): Promise<Ctx> {
  const f = await fsm();
  const file = `${addonsDir()}/${m.id}/data.json`;
  const has = (p: AddonPermission) => m.permissions.includes(p);
  const read = async (): Promise<Record<string, unknown>> => { try { const j = JSON.parse(await f.readFile(file, "utf8")) as unknown; return j && typeof j === "object" ? (j as Record<string, unknown>) : {}; } catch { return {}; } };
  return {
    log: (text) => logServer("info", `[add-on ${m.id}] ${String(text).slice(0, 300)}`),
    notify: async (title, text) => { if (!has("notify")) throw new Error('This add-on needs the "notify" permission to send alerts.'); await pushNotice(`${m.name}: ${String(title).slice(0, 60)}`, String(text).slice(0, 1500)); },
    storage: {
      get: async (key) => { if (!has("storage")) throw new Error('This add-on needs the "storage" permission.'); return (await read())[String(key)]; },
      set: async (key, value) => {
        if (!has("storage")) throw new Error('This add-on needs the "storage" permission.');
        const d = await read(); d[String(key)] = value;
        const text = JSON.stringify(d);
        if (text.length > 200_000) throw new Error("This add-on's data file is full (200 KB).");
        await f.writeFile(file, text, { encoding: "utf8", mode: 0o600 });
      },
    },
  };
}

async function load(m: AddonManifest, hash: string): Promise<Module> {
  const cache = (mem.__addonMods ??= new Map());
  const hit = cache.get(m.id);
  if (hit && hit.hash === hash) return hit.mod;
  const mod = (await import(/* @vite-ignore */ `file://${addonsDir()}/${m.id}/${m.main}?v=${hash}`)) as { default?: Module };
  const out = mod.default ?? {};
  cache.set(m.id, { hash, mod: out });
  return out;
}

const withTimeout = <T,>(p: Promise<T>, ms = 30_000): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("The add-on took too long.")), ms))]);

export async function runCommand(name: string, text: string): Promise<string | null> {
  for (const a of await listAddons()) {
    if (!a.enabled || !a.commands.some((c) => c.name === name)) continue;
    const found = await enabledFound(a.id);
    if (!found) continue;
    try {
      const mod = await load(found.manifest, found.hash);
      const fn = mod.commands?.[name];
      if (!fn) return `The ${a.name} add-on doesn't implement /${name}.`;
      const res = await withTimeout(Promise.resolve(fn(text, await context(found.manifest))));
      return String(res ?? "").slice(0, 6000) || "(no output)";
    } catch (e) { logServer("warn", `[add-on ${a.id}] /${name} failed: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`); return `The ${a.name} add-on had a problem: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`; }
  }
  return null;
}

async function callApi(id: string, name: string, args: unknown): Promise<unknown> {
  const found = await enabledFound(id);
  if (!found) throw new Error("That add-on isn't enabled.");
  const mod = await load(found.manifest, found.hash);
  const fn = mod.api?.[name];
  if (!fn) throw new Error(`The add-on has no function called ${name}.`);
  return withTimeout(Promise.resolve(fn(args, await context(found.manifest))));
}

/** Scheduler hook: run each enabled add-on's jobs when due. Never throws. */
export async function tickAddons(now = Date.now()): Promise<void> {
  if (!dir()) return;
  const runs = (mem.__addonRuns ??= new Map());
  for (const a of await listAddons()) {
    if (!a.enabled || !a.permissions.includes("jobs")) continue;
    for (const j of a.jobs) {
      const key = `${a.id}/${j.id}`;
      const last = runs.get(key);
      if (last === undefined) { runs.set(key, now); continue; } // first sight after a start: wait a full interval
      if (now - last < j.everyMinutes * 60_000) continue;
      runs.set(key, now);
      try {
        const found = await enabledFound(a.id);
        if (!found) continue;
        const mod = await load(found.manifest, found.hash);
        await withTimeout(Promise.resolve(mod.jobs?.[j.id]?.(await context(found.manifest))));
      } catch (e) { logServer("warn", `[add-on ${a.id}] job ${j.id} failed: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`); }
    }
  }
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** GET ?op=list | ?op=window&id=…   POST { op: enable | disable | command | api }. Owner only. */
export async function handleAddons(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return fail("Only the owner account can use add-ons.", 403);
  if (!dir()) return fail("Add-ons need BUDDY_DATA_DIR (the data volume).", 503);
  try {
    if (request.method === "GET") {
      const u = new URL(request.url);
      if (u.searchParams.get("op") === "window") {
        const found = await enabledFound(u.searchParams.get("id") ?? "");
        if (!found?.manifest.window) return fail("No window.", 404);
        const html = await (await fsm()).readFile(`${addonsDir()}/${found.manifest.id}/${found.manifest.window.entry}`, "utf8");
        const page = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${BRIDGE_SCRIPT}`) : `${BRIDGE_SCRIPT}${html}`;
        return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:", "cache-control": "no-store" } });
      }
      return Response.json({ addons: await listAddons() });
    }
    if (request.method !== "POST") return fail("Unsupported.", 405);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b["id"] ?? "");
    switch (b["op"]) {
      case "enable": {
        const found = (await scan()).find((x): x is { manifest: AddonManifest; hash: string } => "manifest" in x && x.manifest.id === id);
        if (!found) return fail("That add-on has problems or doesn't exist.");
        const st = await readState(); st.enabled[id] = found.hash; await writeState(st);
        logServer("info", `Add-on enabled: ${id}`);
        return Response.json({ ok: true, addons: await listAddons() });
      }
      case "disable": {
        const st = await readState(); delete st.enabled[id]; await writeState(st);
        mem.__addonMods?.delete(id);
        return Response.json({ ok: true, addons: await listAddons() });
      }
      case "command": {
        const text = await runCommand(String(b["name"] ?? "").toLowerCase().replace(/^\//, ""), String(b["text"] ?? "").slice(0, 2000));
        return Response.json({ text });
      }
      case "api": return Response.json({ result: await callApi(id, String(b["name"] ?? ""), b["args"]) });
      default: return fail("Unknown action.");
    }
  } catch (e) { return fail(e instanceof Error ? e.message.slice(0, 200) : "Something went wrong.", 502); }
}

