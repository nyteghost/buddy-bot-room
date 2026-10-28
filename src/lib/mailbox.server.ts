import { currentUser } from "./accounts.server";
import { clearMailCache } from "./inbox.server";
import { imapConfig, type ImapConfig } from "./imap.server";
import { withImap, type ImapClient, type TlsOverrides } from "./imap-client.server";
import { createMailCache } from "./mail-cache";
import { allowSend, buildSearch, folderSignature, newestRange, parseSelectInfo, type SelectInfo, buildMessage, isGmailHost, buildNoteMessage, parseNote, type PhoneNote, folderQuote, attachmentBytes, attachmentKind, parseFetchItems, parseFolderList, parseMessage, parseRecipients, parseSummary, parseUidSearch, type Folder, type MailMessage, type MailSummary } from "./mailbox";
import { ackAlert, addAlertRule, alertState, removeAlertRule } from "./mail-alerts.server";
import { logServer } from "./server-log.server";
import { smtpCheck, smtpConfig, smtpSend, type SmtpConfig, type SmtpTlsOverrides } from "./smtp.server";

/**
 * The mailbox: read, send, move and delete over IMAP and SMTP with the account from Settings. Owner only.
 * Folder names are only ever taken from the server's own LIST, so a request can't smuggle in commands.
 * Message bodies are shown as text (never HTML), and nothing is downloaded beyond the first 300 KB of one message.
 */
const BODY_BYTES = 300_000;
const PAGE = 30;

type Hooks = { imap?: TlsOverrides; smtp?: SmtpTlsOverrides };
const hooks: Hooks = {};
/** Test seam: lets a local test server with a self-signed certificate stand in for Gmail. */
export const setMailTlsOverrides = (h: Hooks): void => { hooks.imap = h.imap ?? {}; hooks.smtp = h.smtp ?? {}; };

const envNum = (name: string, fallback: number, min: number, max: number): number => { const n = Number((process.env[name] ?? "").trim()); return Number.isFinite(n) && (process.env[name] ?? "").trim() !== "" ? Math.min(max, Math.max(min, n)) : fallback; };
/** Mail metadata is kept in memory only, per account, for a short time (MAIL_CACHE_SECONDS, 0 turns it off). Sizes are bounded. */
const listTtl = () => envNum("MAIL_CACHE_SECONDS", 30, 0, 600) * 1000;
type CachedList = { sig: string; messages: MailSummary[]; total: number };
const caches = (() => {
  const g = globalThis as unknown as { __pixelMailCache?: { lists: ReturnType<typeof createMailCache<CachedList>>; bodies: ReturnType<typeof createMailCache<MailMessage>>; folders: ReturnType<typeof createMailCache<Folder[]>> } };
  return (g.__pixelMailCache ??= {
    lists: createMailCache<CachedList>({ ttlMs: 600_000, max: 60 }),
    bodies: createMailCache<MailMessage>({ ttlMs: 600_000, max: 30, maxCost: 6_000_000, cost: (m) => m.text.length + 600 }),
    folders: createMailCache<Folder[]>({ ttlMs: 600_000, max: 4 }),
  });
})();
/** Forget everything cached for this account (after a move, delete, flag change, new folder or a manual refresh). */
export function clearMailboxCaches(account?: string): void {
  const mine = (k: string) => !account || k.startsWith(`${account}|`);
  caches.lists.deleteWhere(mine); caches.bodies.deleteWhere(mine); caches.folders.deleteWhere(mine); attachmentCache.deleteWhere(mine);
}
/** Opened attachments, memory only and small: a PDF you just previewed can be downloaded or re-opened without fetching the message again. */
type CachedAttachment = { name: string; type: string; bytes: Uint8Array };
const attachmentCache = (() => {
  const g = globalThis as unknown as { __pixelMailAttachments?: ReturnType<typeof createMailCache<CachedAttachment>> };
  return (g.__pixelMailAttachments ??= createMailCache<CachedAttachment>({ ttlMs: 300_000, max: 6, maxCost: 48_000_000, cost: (a) => a.bytes.length }));
})();
export const attachmentMaxBytes = () => envNum("MAIL_ATTACHMENT_MAX_MB", 25, 1, 100) * 1_000_000;
export const mailCacheStats = () => ({ lists: caches.lists.size, bodies: caches.bodies.size, bodyBytes: caches.bodies.cost, folders: caches.folders.size });

async function folders(c: ImapClient, forceFresh = false): Promise<Folder[]> {
  const key = `${c.account}|folders`;
  const hit = forceFresh ? undefined : caches.folders.get(key, Date.now(), 60_000);
  if (hit) return hit;
  const list = parseFolderList(await c.cmd('LIST "" "*"'));
  caches.folders.set(key, list);
  return list;
}
async function selectFolder(c: ImapClient, name: string): Promise<{ list: Folder[]; folder: Folder; info: SelectInfo }> {
  const find = (list: Folder[]) => (!name || name.toUpperCase() === "INBOX" ? list.find((f) => f.special === "inbox") : list.find((f) => f.name === name));
  let list = await folders(c);
  let folder = find(list);
  if (!folder) { list = await folders(c, true); folder = find(list); } // the cached list may predate a new folder
  if (!folder) throw new Error("That folder doesn't exist.");
  const q = folderQuote(folder.name);
  if (!q) throw new Error("That folder name isn't usable.");
  const info = parseSelectInfo(await c.cmd(`SELECT ${q}`));
  return { list, folder, info };
}
const uidOk = (u: unknown): number => { const n = Number(u); if (!Number.isInteger(n) || n < 1 || n > 4_294_967_295) throw new Error("Bad message number."); return n; };

export type ListResult = { folder: string; folders: Folder[]; messages: MailSummary[]; total: number; account: string; gmail: boolean; offset: number; cached?: boolean };
const HEADER_FIELDS = "UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)]";

/**
 * One page of a folder, newest first. Plain folder views ask the server for just the newest message NUMBERS (no mailbox-wide search),
 * so a 100,000-message folder costs the same as a small one. Searches and "unread only" use the server's own SEARCH.
 * `offset` pages back through older mail. An unchanged folder (same UIDVALIDITY, UIDNEXT and message count) is answered from memory
 * for MAIL_CACHE_SECONDS; `fresh` skips that.
 */
export async function listMessages(cfg: ImapConfig, opts: { folder?: string; q?: string; unread?: boolean; limit?: number; offset?: number; fresh?: boolean } = {}): Promise<ListResult> {
  const q = (opts.q ?? "").trim();
  if (q && !/^[\x20-\x7e]{1,120}$/.test(q)) throw new Error("Search words must be plain letters and numbers (up to 120 characters).");
  const search = q || opts.unread ? buildSearch(q, !!opts.unread) : null;
  if (search?.error) throw new Error(search.error);
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? PAGE) || PAGE), 50);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0) || 0);
  return withImap(cfg, async (c) => {
    const { list, folder, info } = await selectFolder(c, opts.folder ?? "INBOX");
    const base = { folder: folder.name, folders: list, account: cfg.user, gmail: isGmailHost(cfg.host), offset };
    const key = `${c.account}|list|${folder.name}|${search?.criteria ?? ""}|${limit}|${offset}`;
    const sig = folderSignature(info);
    const hit = opts.fresh ? undefined : caches.lists.get(key, Date.now(), listTtl());
    if (hit && hit.sig === sig) return { ...base, messages: hit.messages, total: hit.total, cached: true };
    let messages: MailSummary[] = [];
    let total = info.exists;
    if (!search) {
      const range = newestRange(info.exists, limit, offset);
      if (range) messages = parseFetchItems(await c.cmd(`FETCH ${range.lo}:${range.hi} (${HEADER_FIELDS})`)).map((i) => parseSummary(i.uid, i.flags, i.literal));
    } else {
      const all = parseUidSearch(await c.cmd(`UID SEARCH ${search.criteria}`));
      total = all.length;
      const end = all.length - offset;
      const take = end > 0 ? all.slice(Math.max(0, end - limit), end) : [];
      if (take.length) messages = parseFetchItems(await c.cmd(`UID FETCH ${take.join(",")} (${HEADER_FIELDS})`)).map((i) => parseSummary(i.uid, i.flags, i.literal));
    }
    messages.sort((a, b) => b.uid - a.uid);
    caches.lists.set(key, { sig, messages, total });
    return { ...base, messages, total };
  }, hooks.imap);
}

export async function readMessage(cfg: ImapConfig, folderName: string, uid: unknown, markSeen = true): Promise<MailMessage> {
  const id = uidOk(uid);
  return withImap(cfg, async (c) => {
    const { folder, info } = await selectFolder(c, folderName); // always selected: it also tells us if the folder was rebuilt (UIDVALIDITY)
    const key = `${c.account}|body|${folder.name}|${info.uidvalidity}|${id}`;
    let message = caches.bodies.get(key, Date.now(), listTtl() * 10);
    if (!message) {
      const raw = await c.cmd(`UID FETCH ${id} (UID FLAGS BODY.PEEK[]<0.${BODY_BYTES}>)`);
      const item = parseFetchItems(raw)[0];
      if (!item) throw new Error("That message is gone.");
      message = parseMessage(item.uid, item.flags, item.literal, item.literal.length < BODY_BYTES);
    }
    if (markSeen && !message.seen) {
      await c.cmd(`UID STORE ${id} +FLAGS.SILENT (\\Seen)`).catch(() => undefined);
      message = { ...message, seen: true };
      caches.lists.deleteWhere((k) => k.startsWith(`${c.account}|list|${folder.name}|`)); // the list shows this message as read now
    }
    caches.bodies.set(key, message);
    return message;
  }, hooks.imap);
}

/**
 * One attachment's bytes, fetched only when asked for. The size is checked first (a huge message is refused before it is downloaded), the message is
 * read with BODY.PEEK so it isn't marked read, and the result is cached briefly in memory under this account's key.
 */
export async function readAttachment(cfg: ImapConfig, folderName: string, uid: unknown, index: unknown): Promise<CachedAttachment> {
  const id = uidOk(uid);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n > 19) throw new Error("Bad attachment number.");
  const limit = attachmentMaxBytes();
  return withImap(cfg, async (c) => {
    const { folder, info } = await selectFolder(c, folderName);
    const key = `${c.account}|att|${folder.name}|${info.uidvalidity}|${id}|${n}`;
    const hit = attachmentCache.get(key, Date.now(), listTtl() * 10);
    if (hit) return hit;
    const size = Number(/RFC822\.SIZE (\d+)/i.exec(await c.cmd(`UID FETCH ${id} (RFC822.SIZE)`))?.[1]);
    if (!Number.isFinite(size) || size <= 0) throw new Error("That message is gone.");
    if (size > limit * 1.4) throw new Error(`That message is too large to open here (over ${Math.round(limit / 1_000_000)} MB). Open it in your mail app instead.`);
    const item = parseFetchItems(await c.cmd(`UID FETCH ${id} (UID BODY.PEEK[])`))[0];
    if (!item) throw new Error("That message is gone.");
    const part = attachmentBytes(item.literal, n);
    if (!part) throw new Error("That attachment isn't in the message any more.");
    if (part.bytes.length > limit) throw new Error(`That file is larger than ${Math.round(limit / 1_000_000)} MB, so it isn't opened here.`);
    attachmentCache.set(key, part);
    return part;
  }, hooks.imap);
}

/** The headers that make a download safe even if someone opens the URL directly: the file can't run, be sniffed as HTML, or be kept by shared caches. */
export function attachmentResponse(a: CachedAttachment, download: boolean): Response {
  const kind = attachmentKind(a.name, a.type);
  const type = kind === "pdf" ? "application/pdf" : /\.xlsx$/i.test(a.name) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : /\.xlsm$/i.test(a.name) ? "application/vnd.ms-excel.sheet.macroEnabled.12" : /\.xls$/i.test(a.name) ? "application/vnd.ms-excel" : /\.csv$/i.test(a.name) ? "text/csv; charset=utf-8" : "application/octet-stream";
  const safe = a.name.replace(/[\r\n"\\]/g, "").replace(/[^\x20-\x7e]/g, "_").slice(0, 120) || "attachment";
  return new Response(a.bytes as unknown as BodyInit, {
    headers: {
      "content-type": type,
      "content-length": String(a.bytes.length),
      "content-disposition": `${download || kind === "other" ? "attachment" : "inline"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(a.name.slice(0, 200))}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
}

export async function setSeen(cfg: ImapConfig, folderName: string, uid: unknown, seen: boolean): Promise<void> {
  const id = uidOk(uid);
  await withImap(cfg, async (c) => { await selectFolder(c, folderName); await c.cmd(`UID STORE ${id} ${seen ? "+" : "-"}FLAGS.SILENT (\\Seen)`); clearMailboxCaches(c.account); }, hooks.imap);
}

async function moveInside(c: ImapClient, id: number, destQuoted: string): Promise<void> {
  if (/\bMOVE\b/.test(c.capabilities)) { await c.cmd(`UID MOVE ${id} ${destQuoted}`); return; }
  await c.cmd(`UID COPY ${id} ${destQuoted}`);
  await c.cmd(`UID STORE ${id} +FLAGS.SILENT (\\Deleted)`);
  await c.cmd(/\bUIDPLUS\b/.test(c.capabilities) ? `UID EXPUNGE ${id}` : "EXPUNGE");
}

export async function moveMessage(cfg: ImapConfig, folderName: string, uid: unknown, destName: string): Promise<{ moved: string }> {
  const id = uidOk(uid);
  return withImap(cfg, async (c) => {
    const { list, folder } = await selectFolder(c, folderName);
    const dest = list.find((f) => f.name === destName);
    if (!dest) throw new Error("That destination folder doesn't exist.");
    if (dest.name === folder.name) throw new Error("It is already in that folder.");
    const q = folderQuote(dest.name);
    if (!q) throw new Error("That folder name isn't usable.");
    await moveInside(c, id, q);
    clearMailboxCaches(c.account);
    return { moved: dest.label };
  }, hooks.imap);
}

/** Into Trash (recoverable). Inside Trash or Spam it is deleted for good. */
export async function deleteMessage(cfg: ImapConfig, folderName: string, uid: unknown): Promise<{ forever: boolean }> {
  const id = uidOk(uid);
  return withImap(cfg, async (c) => {
    const { list, folder } = await selectFolder(c, folderName);
    if (folder.special === "trash" || folder.special === "junk") {
      await c.cmd(`UID STORE ${id} +FLAGS.SILENT (\\Deleted)`);
      await c.cmd(/\bUIDPLUS\b/.test(c.capabilities) ? `UID EXPUNGE ${id}` : "EXPUNGE");
      clearMailboxCaches(c.account);
      return { forever: true };
    }
    const trash = list.find((f) => f.special === "trash");
    const q = trash && folderQuote(trash.name);
    if (!trash || !q) throw new Error("There's no Trash folder on this account. Move it to another folder instead.");
    await moveInside(c, id, q);
    clearMailboxCaches(c.account);
    return { forever: false };
  }, hooks.imap);
}

// ---------- phone notes: iPhone Notes kept in the Gmail account's "Notes" label ----------

const NOTES_LABEL = "Notes";
const noteFolder = (list: Folder[]): Folder | undefined => list.find((f) => f.name.toLowerCase() === NOTES_LABEL.toLowerCase());

export async function listNotes(cfg: ImapConfig): Promise<{ notes: PhoneNote[]; found: boolean }> {
  return withImap(cfg, async (c) => {
    const list = await folders(c);
    const folder = noteFolder(list);
    if (!folder) return { notes: [], found: false };
    const q = folderQuote(folder.name);
    if (!q) throw new Error("The Notes folder name isn't usable.");
    await c.cmd(`SELECT ${q}`);
    const ids = parseUidSearch(await c.cmd("UID SEARCH ALL")).slice(-40);
    if (!ids.length) return { notes: [], found: true };
    const raw = await c.cmd(`UID FETCH ${ids.join(",")} (UID BODY.PEEK[]<0.20000>)`);
    const notes = parseFetchItems(raw).map((i) => parseNote(i.uid, i.literal)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return { notes, found: true };
  }, hooks.imap);
}

/** Saves a note: a new message in the Notes label. Editing writes the new version with the same id, then removes the old one (as the iPhone does). */
export async function saveNote(cfg: ImapConfig, input: { uid?: unknown; uuid?: string; title: string; text: string }): Promise<{ uuid: string }> {
  const title = String(input.title ?? "").trim();
  const text = String(input.text ?? "");
  if (!title && !text.trim()) throw new Error("Write something first.");
  if (text.length > 15_000) throw new Error("That note is too long (15,000 characters at most).");
  const old = input.uid ? uidOk(input.uid) : 0;
  const uuid = (/^[A-Za-z0-9-]{8,64}$/.test(input.uuid ?? "") ? input.uuid! : crypto.randomUUID()).toUpperCase();
  const raw = buildNoteMessage({ from: cfg.user, title, text, uuid, messageId: `<${crypto.randomUUID()}@pixelpals.local>` });
  await withImap(cfg, async (c) => {
    let list = await folders(c);
    let folder = noteFolder(list);
    if (!folder) { await c.cmd(`CREATE "${NOTES_LABEL}"`); list = await folders(c, true); folder = noteFolder(list); }
    const q = folder && folderQuote(folder.name);
    if (!q) throw new Error("There's no Notes folder on this account.");
    await c.append(q, raw);
    if (old) {
      await c.cmd(`SELECT ${q}`);
      await c.cmd(`UID STORE ${old} +FLAGS.SILENT (\\Deleted)`);
      await c.cmd(/\bUIDPLUS\b/.test(c.capabilities) ? `UID EXPUNGE ${old}` : "EXPUNGE");
    }
    clearMailboxCaches(c.account);
  }, hooks.imap);
  clearMailCache();
  return { uuid };
}

export async function deleteNote(cfg: ImapConfig, uid: unknown): Promise<void> {
  const id = uidOk(uid);
  await withImap(cfg, async (c) => {
    const { list, folder } = await selectFolder(c, NOTES_LABEL);
    if (!noteFolder(list) || folder.name !== noteFolder(list)?.name) throw new Error("That note is gone.");
    const trash = list.find((f) => f.special === "trash");
    const tq = trash && folderQuote(trash.name);
    if (!tq) throw new Error("There's no Trash folder on this account.");
    await moveInside(c, id, tq);
    clearMailboxCaches(c.account);
  }, hooks.imap);
  clearMailCache();
}

let sentTimes: number[] = [];

export type SendInput = { to: string; cc?: string; subject: string; text: string; inReplyTo?: string; references?: string; attachments?: { name: string; type: string; data: string }[] };

export async function sendMail(cfg: SmtpConfig, input: SendInput, now = Date.now()): Promise<{ to: string[] }> {
  const to = parseRecipients(input.to ?? "");
  if (!to?.length) throw new Error("Check the To address (separate several with commas, up to 20).");
  const cc = input.cc?.trim() ? parseRecipients(input.cc) : [];
  if (!cc) throw new Error("Check the Cc address.");
  const subject = (input.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const text = String(input.text ?? "");
  if (!subject && !text.trim()) throw new Error("Write a subject or a message first.");
  if (text.length > 100_000) throw new Error("That message is too long.");
  const attachments = (input.attachments ?? []).slice(0, 5);
  if (attachments.reduce((n, a) => n + String(a.data ?? "").length, 0) > 7_000_000) throw new Error("The attachments are too big to email.");
  const gate = allowSend(sentTimes, now);
  if (!gate.ok) throw new Error("That's 20 emails in the past hour, which is the limit. Try again later.");
  const messageId = `<${crypto.randomUUID()}@${cfg.from.split("@")[1] ?? "pixelpals.local"}>`;
  const raw = buildMessage({ from: cfg.from, fromName: cfg.name, to, cc, subject: subject || "(no subject)", text, messageId, ...(attachments.length ? { attachments } : {}), ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}), ...(input.references ? { references: input.references } : {}) });
  await smtpSend(cfg, { to: [...to, ...cc], raw }, hooks.smtp);
  sentTimes = gate.times;
  logServer("info", `Mail sent to ${to.length + cc.length} recipient(s)`);
  return { to: [...to, ...cc] };
}

/** Used by the Settings test: signs in to SMTP without sending anything. */
export async function mailSendReady(): Promise<{ ok: boolean; note: string }> {
  const cfg = smtpConfig();
  if (!cfg) return { ok: false, note: "Sending needs your mail address as the username (and an SMTP server if it isn't the usual imap→smtp name)." };
  try { await smtpCheck(cfg, hooks.smtp); return { ok: true, note: `Sending is ready (${cfg.host}).` }; }
  catch (e) { return { ok: false, note: e instanceof Error ? e.message.slice(0, 140) : "Couldn't sign in to the mail server for sending." }; }
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const msg = (e: unknown) => (e instanceof Error ? e.message.slice(0, 160) : "Something went wrong.");

/** GET ?op=list|read, POST { op: send|delete|move|seen }. Owner only. */
export async function handleMailbox(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return fail("Only the owner account can use the mailbox.", 403);
  const cfg = imapConfig();
  if (!cfg) return fail("No mail account is set up yet. Open Settings → Mail.", 409);
  try {
    if (request.method === "GET") {
      const u = new URL(request.url);
      const folder = u.searchParams.get("folder") ?? "INBOX";
      if (u.searchParams.get("op") === "alerts") return Response.json(await alertState());
      if (u.searchParams.get("op") === "notes") return Response.json(await listNotes(cfg));
      if (u.searchParams.get("op") === "attachment") {
        const a = await readAttachment(cfg, folder, u.searchParams.get("uid"), u.searchParams.get("index"));
        return attachmentResponse(a, u.searchParams.get("download") === "1");
      }
      if (u.searchParams.get("op") === "read") {
        const message = await readMessage(cfg, folder, u.searchParams.get("uid"), u.searchParams.get("keep") !== "1");
        clearMailCache();
        return Response.json({ message });
      }
      return Response.json(await listMessages(cfg, { folder, q: u.searchParams.get("q") ?? "", unread: u.searchParams.get("unread") === "1", limit: Number(u.searchParams.get("limit")) || PAGE, offset: Number(u.searchParams.get("offset")) || 0, fresh: u.searchParams.get("fresh") === "1" }));
    }
    if (request.method !== "POST") return fail("Unsupported.", 405);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const folder = String(b["folder"] ?? "INBOX");
    switch (b["op"]) {
      case "send": {
        const smtp = smtpConfig();
        if (!smtp) return fail("Sending isn't set up. Your mail username must be your full address.", 409);
        const sent = await sendMail(smtp, { to: String(b["to"] ?? ""), cc: String(b["cc"] ?? ""), subject: String(b["subject"] ?? ""), text: String(b["text"] ?? ""), ...(b["inReplyTo"] ? { inReplyTo: String(b["inReplyTo"]) } : {}), ...(b["references"] ? { references: String(b["references"]) } : {}), ...(Array.isArray(b["attachments"]) ? { attachments: (b["attachments"] as Record<string, unknown>[]).map((a) => ({ name: String(a["name"] ?? ""), type: String(a["type"] ?? ""), data: String(a["data"] ?? "") })) } : {}) });
        return Response.json({ ok: true, to: sent.to });
      }
      case "alert-rule-add": return Response.json({ ok: true, rules: await addAlertRule(String(b["kind"] ?? ""), String(b["value"] ?? "")) });
      case "alert-rule-remove": return Response.json({ ok: true, rules: await removeAlertRule(String(b["id"] ?? "")) });
      case "alert-ack": await ackAlert(String(b["id"] ?? "")); return Response.json({ ok: true });
      case "note-save": return Response.json({ ok: true, ...(await saveNote(cfg, { uid: b["uid"], uuid: String(b["uuid"] ?? ""), title: String(b["title"] ?? ""), text: String(b["text"] ?? "") })) });
      case "note-delete": { await deleteNote(cfg, b["uid"]); return Response.json({ ok: true }); }
      case "delete": { const r = await deleteMessage(cfg, folder, b["uid"]); clearMailCache(); return Response.json({ ok: true, ...r }); }
      case "move": { const r = await moveMessage(cfg, folder, b["uid"], String(b["to"] ?? "")); clearMailCache(); return Response.json({ ok: true, ...r }); }
      case "seen": { await setSeen(cfg, folder, b["uid"], b["seen"] !== false); clearMailCache(); return Response.json({ ok: true }); }
      default: return fail("Unknown action.");
    }
  } catch (e) {
    logServer("warn", `Mailbox: ${msg(e)}`);
    return fail(msg(e), 502);
  }
}

