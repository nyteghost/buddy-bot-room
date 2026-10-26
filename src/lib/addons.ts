/**
 * Add-ons: folders you drop into <data>/addons/<id>/ to add windows, slash commands and background jobs without touching Pixel Pals' own code.
 * This file is the pure part: reading and checking a manifest (addon.json).
 */
export const ADDON_PERMISSIONS = ["commands", "window", "jobs", "notify", "storage"] as const;
export type AddonPermission = (typeof ADDON_PERMISSIONS)[number];
export const PERMISSION_TEXT: Record<AddonPermission, string> = {
  commands: "Add slash commands you can type in chat",
  window: "Show its own window in the workspace",
  jobs: "Run in the background on a timer",
  notify: "Send you phone alerts (ntfy / Telegram)",
  storage: "Keep a small data file of its own",
};

export type AddonManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: AddonPermission[];
  main: string;
  commands: { name: string; help: string }[];
  window?: { title: string; entry: string } | undefined;
  jobs: { id: string; everyMinutes: number }[];
};

const ID = /^[a-z0-9][a-z0-9-]{1,31}$/;
const CMD = /^[a-z0-9-]{2,20}$/;
const FILE = /^[A-Za-z0-9._-]{1,60}$/; // a plain file name in the add-on's own folder, never a path
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A manifest that is safe to use, or a list of what is wrong with it. */
export function parseManifest(raw: unknown, folder: string): { ok: true; manifest: AddonManifest } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = str(o["id"], 32);
  if (!ID.test(id)) problems.push("id must be 3-32 lowercase letters, numbers or dashes");
  else if (id !== folder) problems.push(`id "${id}" must match the folder name "${folder}"`);
  const name = str(o["name"], 60);
  if (!name) problems.push("name is missing");
  const perms: AddonPermission[] = [];
  for (const p of Array.isArray(o["permissions"]) ? o["permissions"] : []) {
    if (!(ADDON_PERMISSIONS as readonly unknown[]).includes(p)) problems.push(`unknown permission "${String(p).slice(0, 20)}"`);
    else if (!perms.includes(p as AddonPermission)) perms.push(p as AddonPermission);
  }
  const main = str(o["main"], 60) || "server.mjs";
  if (!FILE.test(main) || !/\.m?js$/.test(main)) problems.push("main must be a .mjs or .js file name in the add-on's folder");
  const commands: AddonManifest["commands"] = [];
  for (const c of Array.isArray(o["commands"]) ? o["commands"].slice(0, 20) : []) {
    const cc = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const n = str(cc["name"], 20).toLowerCase();
    if (!CMD.test(n)) { problems.push(`command name "${n}" must be 2-20 lowercase letters, numbers or dashes`); continue; }
    commands.push({ name: n, help: str(cc["help"], 120) });
  }
  if (commands.length && !perms.includes("commands")) problems.push('commands need the "commands" permission');
  let windowSpec: AddonManifest["window"];
  if (o["window"] !== undefined) {
    const w = (o["window"] && typeof o["window"] === "object" ? o["window"] : {}) as Record<string, unknown>;
    const entry = str(w["entry"], 60) || "window.html";
    if (!FILE.test(entry) || !/\.html?$/.test(entry)) problems.push("window.entry must be an .html file name in the add-on's folder");
    else windowSpec = { title: str(w["title"], 40) || name || id, entry };
    if (!perms.includes("window")) problems.push('a window needs the "window" permission');
  }
  const jobs: AddonManifest["jobs"] = [];
  for (const j of Array.isArray(o["jobs"]) ? o["jobs"].slice(0, 10) : []) {
    const jj = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
    const jid = str(jj["id"], 30);
    const every = Number(jj["everyMinutes"]);
    if (!/^[a-z0-9-]{1,30}$/.test(jid) || !Number.isFinite(every) || every < 1 || every > 1440) { problems.push("each job needs an id and everyMinutes between 1 and 1440"); continue; }
    jobs.push({ id: jid, everyMinutes: Math.round(every) });
  }
  if (jobs.length && !perms.includes("jobs")) problems.push('jobs need the "jobs" permission');
  if (problems.length) return { ok: false, problems };
  return { ok: true, manifest: { id, name, version: str(o["version"], 20) || "0.0.0", description: str(o["description"], 300), author: str(o["author"], 60), permissions: perms, main, commands, window: windowSpec, jobs } };
}

/** The script the window page gets: a tiny bridge so the add-on's page can talk to its server code. */
export const BRIDGE_SCRIPT = `<script>(function(){var n=0,p={};window.addEventListener("message",function(e){var d=e.data;if(d&&d.ppReply&&p[d.id]){var f=p[d.id];delete p[d.id];d.error?f[1](new Error(d.error)):f[0](d.result)}});window.pp={call:function(name,args){return new Promise(function(res,rej){var id=++n;p[id]=[res,rej];parent.postMessage({ppCall:true,id:id,name:String(name),args:args},"*")})}};})();</script>`;

export type AddonInfo = {
  id: string; name: string; version: string; description: string; author: string;
  permissions: AddonPermission[]; permissionText: string[]; commands: { name: string; help: string }[]; window?: { title: string } | undefined;
  jobs: { id: string; everyMinutes: number }[]; enabled: boolean; changed: boolean; problems: string[];
};
