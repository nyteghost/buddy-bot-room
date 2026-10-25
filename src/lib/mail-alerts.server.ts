import { imapConfig } from "./imap.server";
import { withImap } from "./imap-client.server";
import { folderQuote, parseFetchItems, parseFolderList, parseMessage, parseUidSearch } from "./mailbox";
import { DEFAULT_RULES, MAX_RULES, matchRules, parseRules, type AlertRule, type MailAlert } from "./mail-alerts";
import { pushNotice } from "./schedules.server";
import { logServer } from "./server-log.server";

/**
 * Watches the mailbox for new mail that matches your rules (a sender, or words in the subject/start of the message).
 * Looks at All Mail (so every label and folder) and Spam; plain IMAP accounts get the Inbox and Junk. New matches become
 * pending alerts the Pixel Pals window shows as a pop-up, and a phone push. The first check only records where it is, so old mail never alerts.
 */
type FolderState = { validity: string; last: number };
type Store = { rules: AlertRule[]; folders: Record<string, FolderState>; pending: MailAlert[]; seen: string[] };

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fsm = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/mail-alerts.json`;
const mem = globalThis as unknown as { __mailAlerts?: Store; __mailAlertsRun?: { at: number; busy: boolean } };

let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

async function load(): Promise<Store> {
  if (!dir()) return (mem.__mailAlerts ??= { rules: [...DEFAULT_RULES], folders: {}, pending: [], seen: [] });
  try {
    const j = JSON.parse(await (await fsm()).readFile(file(), "utf8")) as Partial<Store>;
    return { rules: parseRules(j.rules), folders: j.folders && typeof j.folders === "object" ? j.folders : {}, pending: Array.isArray(j.pending) ? j.pending : [], seen: Array.isArray(j.seen) ? j.seen.slice(-400) : [] };
  } catch { return { rules: [...DEFAULT_RULES], folders: {}, pending: [], seen: [] }; }
}
async function save(s: Store): Promise<void> {
  if (!dir()) { mem.__mailAlerts = s; return; }
  const f = await fsm();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${file()}.tmp`, JSON.stringify(s), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${file()}.tmp`, file());
}

export async function alertState(): Promise<{ rules: AlertRule[]; alerts: MailAlert[] }> {
  const s = await load();
  const cutoff = Date.now() - 3 * 86_400_000;
  return { rules: s.rules, alerts: s.pending.filter((a) => a.at > cutoff) };
}
export const addAlertRule = (kind: string, value: string): Promise<AlertRule[]> => locked(async () => {
  const v = String(value ?? "").trim().slice(0, 80);
  if (kind !== "from" && kind !== "keyword") throw new Error("Unknown rule type.");
  if (v.length < 3) throw new Error("Type at least 3 characters.");
  const s = await load();
  if (s.rules.length >= MAX_RULES) throw new Error(`That's the most rules (${MAX_RULES}).`);
  if (!s.rules.some((r) => r.kind === kind && r.value.toLowerCase() === v.toLowerCase())) s.rules.push({ id: crypto.randomUUID().slice(0, 8), kind, value: v });
  await save(s);
  return s.rules;
});
export const removeAlertRule = (id: string): Promise<AlertRule[]> => locked(async () => { const s = await load(); s.rules = s.rules.filter((r) => r.id !== id); await save(s); return s.rules; });
export const ackAlert = (id: string): Promise<void> => locked(async () => { const s = await load(); s.pending = s.pending.filter((a) => a.id !== id); await save(s); });

const senderLabel = (from: string, addr: string): string => (from.replace(/<[^>]*>/g, "").replace(/["']/g, "").trim() || addr).slice(0, 80);

/** Called by the scheduler; does real work about once a minute. */
export async function tickMailAlerts(now = Date.now()): Promise<void> {
  const cfg = imapConfig();
  if (!cfg) return;
  const run = (mem.__mailAlertsRun ??= { at: 0, busy: false });
  if (run.busy || now - run.at < 60_000) return;
  run.busy = true; run.at = now;
  try {
    const store = await load();
    if (!store.rules.length) return;
    const fresh: MailAlert[] = [];
    await withImap(cfg, async (c) => {
      const list = parseFolderList(await c.cmd('LIST "" "*"'));
      const all = list.find((f) => f.special === "all");
      const targets = [all ?? list.find((f) => f.special === "inbox"), list.find((f) => f.special === "junk")].filter((f): f is NonNullable<typeof f> => !!f);
      for (const folder of targets) {
        const q = folderQuote(folder.name);
        if (!q) continue;
        const sel = await c.cmd(`EXAMINE ${q}`);
        const validity = /UIDVALIDITY (\d+)/.exec(sel)?.[1] ?? "";
        const next = Number(/UIDNEXT (\d+)/.exec(sel)?.[1] ?? 0);
        if (!next) continue;
        const st = store.folders[folder.name];
        if (!st || st.validity !== validity) { store.folders[folder.name] = { validity, last: next - 1 }; continue; }
        if (next - 1 <= st.last) continue;
        const ids = parseUidSearch(await c.cmd(`UID SEARCH UID ${st.last + 1}:*`)).filter((u) => u > st.last).slice(0, 20);
        if (!ids.length) { st.last = next - 1; continue; }
        const raw = await c.cmd(`UID FETCH ${ids.join(",")} (UID BODY.PEEK[]<0.20000>)`);
        for (const item of parseFetchItems(raw)) {
          const m = parseMessage(item.uid, [], item.literal);
          const key = m.messageId || `${folder.name}:${item.uid}`;
          if (store.seen.includes(key)) continue;
          store.seen.push(key);
          if (!matchRules(store.rules, m)) continue;
          fresh.push({ id: crypto.randomUUID().slice(0, 10), folder: folder.name, uid: item.uid, from: senderLabel(m.from, m.fromAddr), subject: m.subject.slice(0, 200) || "(no subject)", preview: m.text.replace(/\s+/g, " ").slice(0, 200), spam: folder.special === "junk", at: now });
        }
        st.last = Math.max(st.last, ...ids);
      }
    });
    await locked(async () => {
      const cur = await load();
      await save({ ...cur, folders: store.folders, seen: store.seen.slice(-400), pending: [...cur.pending.filter((p) => p.at > now - 3 * 86_400_000), ...fresh].slice(-20) });
    });
    for (const a of fresh) await pushNotice(`Email from ${a.from}`, `${a.spam ? "(in Spam) " : ""}${a.subject}\n\n${a.preview}`).catch(() => undefined);
    if (fresh.length) logServer("info", `Mail alert: ${fresh.length} new matching message(s)`);
  } catch (e) {
    logServer("warn", `Mail alerts: ${e instanceof Error ? e.message.slice(0, 120) : "check failed"}`);
  } finally { run.busy = false; }
}
