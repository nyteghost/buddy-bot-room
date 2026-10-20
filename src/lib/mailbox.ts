import { decodeMimeWords, senderName } from "./imap";

/**
 * Pure helpers for the mailbox (read, send, move, delete): folder lists, FETCH replies, MIME bodies,
 * outgoing messages and address checks. No network here, so all of it is unit tested.
 */
export type Folder = { name: string; label: string; special: "inbox" | "trash" | "sent" | "drafts" | "junk" | "archive" | "all" | "flagged" | ""; };
export type MailSummary = { uid: number; from: string; fromAddr: string; to: string; subject: string; date: string; seen: boolean };
export type MailMessage = MailSummary & { cc: string; messageId: string; references: string; text: string; truncated: boolean; attachments: string[] };

// ---------- folder names ----------

/** IMAP "modified UTF-7" → text, for folders with accents or emoji. */
export function decodeMutf7(s: string): string {
  return s.replace(/&([^-]*)-/g, (_m, chunk: string) => {
    if (!chunk) return "&";
    try {
      const b64 = chunk.replace(/,/g, "/");
      const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
      let out = "";
      for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
      return out;
    } catch { return chunk; }
  });
}

const SPECIAL: Record<string, Folder["special"]> = { "\\trash": "trash", "\\sent": "sent", "\\drafts": "drafts", "\\junk": "junk", "\\spam": "junk", "\\archive": "archive", "\\all": "all", "\\flagged": "flagged" };

export function parseFolderList(raw: string): Folder[] {
  const out: Folder[] = [];
  const re = /^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))\r?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const attrs = (m[1] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (attrs.includes("\\noselect") || attrs.includes("\\nonexistent")) continue;
    const name = (m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : (m[3] ?? "")).trim();
    if (!name) continue;
    let special: Folder["special"] = name.toUpperCase() === "INBOX" ? "inbox" : "";
    for (const a of attrs) if (SPECIAL[a]) special = SPECIAL[a] ?? special;
    if (!special) {
      const base = name.toLowerCase().split("/").pop() ?? "";
      if (base === "trash" || base === "deleted items" || base === "deleted messages") special = "trash";
      else if (base === "sent" || base === "sent items" || base === "sent mail") special = "sent";
      else if (base === "spam" || base === "junk" || base === "junk e-mail") special = "junk";
      else if (base === "drafts") special = "drafts";
      else if (base === "archive") special = "archive";
    }
    out.push({ name, label: decodeMutf7(name).replace(/^\[Gmail\]\//i, ""), special });
  }
  const order = ["inbox", "drafts", "sent", "archive", "all", "junk", "trash"];
  return out.sort((a, b) => {
    const ai = order.indexOf(a.special); const bi = order.indexOf(b.special);
    if (ai !== bi) return (ai < 0 ? 50 : ai) - (bi < 0 ? 50 : bi);
    return a.label.localeCompare(b.label);
  });
}

/** Quoted string for a folder name that came from the server's own LIST. */
export function folderQuote(name: string): string | null {
  return /[\r\n\0]/.test(name) || name.length > 200 ? null : `"${name.replace(/[\\"]/g, "\\$&")}"`;
}

// ---------- FETCH replies ----------

export type FetchItem = { uid: number; flags: string[]; literal: string };

/** Reads each `* n FETCH (UID 5 FLAGS (\Seen) BODY[...] {len}\r\n<bytes> ...)`. Text must be latin1 so lengths are bytes. */
export function parseFetchItems(raw: string): FetchItem[] {
  const out: FetchItem[] = [];
  const re = /\* \d+ FETCH \(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const lit = /\{(\d+)\}\r\n/.exec(raw.slice(start, start + 600));
    let prefix: string; let literal = ""; let end: number;
    if (lit) {
      const len = Number(lit[1]);
      const litStart = start + lit.index + lit[0].length;
      prefix = raw.slice(start, start + lit.index);
      literal = raw.slice(litStart, litStart + len);
      const nl = raw.indexOf("\r\n", litStart + len);
      end = nl < 0 ? raw.length : nl + 2;
      prefix += " " + raw.slice(litStart + len, nl < 0 ? raw.length : nl);
    } else {
      const nl = raw.indexOf("\r\n", start);
      end = nl < 0 ? raw.length : nl + 2;
      prefix = raw.slice(start, nl < 0 ? raw.length : nl);
    }
    const uid = Number(/UID (\d+)/.exec(prefix)?.[1]);
    const flags = (/FLAGS \(([^)]*)\)/.exec(prefix)?.[1] ?? "").split(/\s+/).filter(Boolean);
    if (Number.isInteger(uid) && uid > 0) out.push({ uid, flags, literal });
    re.lastIndex = Math.max(end, start);
  }
  return out;
}

/** UIDs from "* SEARCH 4 9 12". */
export function parseUidSearch(raw: string): number[] {
  const m = /^\* SEARCH ?([\d ]*)\r?$/m.exec(raw);
  return (m?.[1] ?? "").split(" ").map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

export const addressOf = (header: string): string => {
  const d = decodeMimeWords(header).trim();
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(d);
  if (angle) return angle[1] ?? "";
  return /^[^\s<>,;"]+@[^\s<>,;"]+$/.test(d) ? d : "";
};

function headerGet(unfolded: string, name: string): string {
  return new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(unfolded)?.[1]?.trim() ?? "";
}
export const unfold = (block: string): string => block.replace(/\r?\n[ \t]+/g, " ");

export function parseSummary(uid: number, flags: string[], block: string): MailSummary {
  const h = unfold(block);
  const from = headerGet(h, "From");
  return {
    uid,
    from: senderName(from),
    fromAddr: addressOf(from),
    to: decodeMimeWords(headerGet(h, "To")).slice(0, 200),
    subject: decodeMimeWords(headerGet(h, "Subject")).slice(0, 200) || "(no subject)",
    date: headerGet(h, "Date"),
    seen: flags.some((f) => f.toLowerCase() === "\\seen"),
  };
}

// ---------- MIME bodies ----------

const toBytes = (latin1: string): Uint8Array => { const b = new Uint8Array(latin1.length); for (let i = 0; i < latin1.length; i++) b[i] = latin1.charCodeAt(i) & 0xff; return b; };

function decodeQuotedPrintable(s: string): Uint8Array {
  const text = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) { out.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(text.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function decodeTransfer(body: string, encoding: string): Uint8Array {
  const e = encoding.trim().toLowerCase();
  if (e === "base64") { try { return toBytes(atob(body.replace(/[^A-Za-z0-9+/]/g, "").replace(/(.{4})*$/, (m) => m))) ; } catch { return toBytes(""); } }
  if (e === "quoted-printable") return decodeQuotedPrintable(body);
  return toBytes(body);
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  const cs = (charset || "utf-8").trim().replace(/^"|"$/g, "").toLowerCase();
  const name = /^(utf-?8|us-ascii|ascii)$/.test(cs) ? "utf-8" : cs;
  try { return new TextDecoder(name).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitMessage(raw: string): { headers: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? { headers: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) } : { headers: raw, body: "" };
}

const param = (value: string, name: string): string => {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value);
  return (m?.[1] ?? m?.[2] ?? "").trim();
};

type Extracted = { plain: string[]; html: string[]; attachments: string[] };

function walk(raw: string, depth: number, into: Extracted): void {
  if (depth > 6) return;
  const { headers, body } = splitMessage(raw);
  const h = unfold(headers);
  const ct = headerGet(h, "Content-Type") || "text/plain";
  const type = (ct.split(";")[0] ?? "text/plain").trim().toLowerCase();
  const disp = headerGet(h, "Content-Disposition");
  const filename = decodeMimeWords(param(disp, "filename") || param(ct, "name"));
  if (type.startsWith("multipart/")) {
    const boundary = param(ct, "boundary");
    if (!boundary) return;
    const marker = `--${boundary}`;
    const parts = body.split(marker).slice(1);
    for (const part of parts) {
      if (part.startsWith("--")) break;
      walk(part.replace(/^\r?\n/, ""), depth + 1, into);
    }
    return;
  }
  if (/^attachment/i.test(disp) || (filename && !type.startsWith("text/"))) { if (filename) into.attachments.push(filename); return; }
  if (type === "text/plain" || type === "text/html") {
    const text = decodeCharset(decodeTransfer(body, headerGet(h, "Content-Transfer-Encoding")), param(ct, "charset"));
    (type === "text/html" ? into.html : into.plain).push(text);
  } else if (filename) into.attachments.push(filename);
}

/** The readable text of a raw message (plain text preferred, HTML turned into text), plus attachment names. Never returns HTML. */
export function extractBody(raw: string, maxChars = 30_000): { text: string; truncated: boolean; attachments: string[] } {
  const into: Extracted = { plain: [], html: [], attachments: [] };
  walk(raw, 0, into);
  let text = into.plain.join("\n\n").trim();
  if (!text && into.html.length) text = htmlToText(into.html.join("\n\n"));
  text = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  const truncated = text.length > maxChars;
  return { text: truncated ? text.slice(0, maxChars) : text, truncated, attachments: into.attachments.slice(0, 20) };
}

export function parseMessage(uid: number, flags: string[], raw: string): MailMessage {
  const { headers } = splitMessage(raw);
  const h = unfold(headers);
  const body = extractBody(raw);
  return {
    ...parseSummary(uid, flags, headers),
    cc: decodeMimeWords(headerGet(h, "Cc")).slice(0, 200),
    messageId: headerGet(h, "Message-ID").slice(0, 200),
    references: headerGet(h, "References").slice(0, 600),
    text: body.text,
    truncated: body.truncated,
    attachments: body.attachments,
  };
}

// ---------- sending ----------

const ADDR = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,250}[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
export const validAddress = (a: string): boolean => ADDR.test(a) && a.length <= 254;

/** "a@x.test, Ann <b@y.test>" → ["a@x.test", "b@y.test"]; null when anything is not an address. */
export function parseRecipients(input: string, max = 20): string[] | null {
  const parts = input.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > max) return null;
  const out: string[] = [];
  for (const p of parts) {
    const angle = /<([^<>]+)>\s*$/.exec(p);
    const addr = (angle?.[1] ?? p).trim();
    if (!validAddress(addr)) return null;
    if (!out.includes(addr.toLowerCase())) out.push(addr.toLowerCase());
  }
  return out;
}

const b64 = (bytes: Uint8Array): string => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const wrap76 = (s: string): string => s.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");

/** RFC 2047 encoded word for a header value with non-ASCII characters. */
export function encodeHeaderText(s: string): string {
  const clean = s.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${b64(new TextEncoder().encode(clean))}?=`;
}

export type Outgoing = { from: string; fromName?: string; to: string[]; cc?: string[]; subject: string; text: string; inReplyTo?: string; references?: string; messageId: string; date?: Date };

/** A plain-text UTF-8 message with CRLF line ends. Header values can't carry line breaks, so nothing typed in the form can add headers. */
export function buildMessage(o: Outgoing): string {
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const name = oneLine(o.fromName ?? "").replace(/["\\<>]/g, "");
  const fromHdr = name ? `${encodeHeaderText(name).includes("=?") ? encodeHeaderText(name) : `"${name}"`} <${o.from}>` : o.from;
  const lines = [
    `From: ${fromHdr}`,
    `To: ${o.to.join(", ")}`,
    ...(o.cc?.length ? [`Cc: ${o.cc.join(", ")}`] : []),
    `Subject: ${encodeHeaderText(o.subject.slice(0, 300))}`,
    `Date: ${(o.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${oneLine(o.messageId)}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${oneLine(o.inReplyTo).slice(0, 200)}`] : []),
    ...(o.references ? [`References: ${oneLine(o.references).slice(0, 600)}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body = wrap76(b64(new TextEncoder().encode(o.text.replace(/\r\n?|\n/g, "\r\n"))));
  return `${lines.join("\r\n")}\r\n\r\n${body}\r\n`;
}

export const replySubject = (s: string): string => (/^\s*re:/i.test(s) ? s.trim() : `Re: ${s.trim()}`).slice(0, 300);
export const forwardableQuote = (from: string, date: string, text: string): string => {
  const when = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toLocaleString() : date;
  const quoted = text.split("\n").slice(0, 60).map((l) => `> ${l}`).join("\n");
  return `\n\nOn ${when}, ${from} wrote:\n${quoted}`;
};

/** Sends are limited so a stuck script or a stolen session can't spam: at most `max` per rolling hour. */
export function allowSend(times: number[], now: number, max = 20): { ok: boolean; times: number[] } {
  const recent = times.filter((t) => now - t < 3_600_000);
  return recent.length >= max ? { ok: false, times: recent } : { ok: true, times: [...recent, now] };
}

// ---------- SMTP ----------

/** The last reply in a (possibly multi-line) SMTP response, or null while it is still arriving. */
export function parseSmtpReply(buf: string): { code: number; text: string; rest: string } | null {
  const lines = buf.split("\r\n");
  let consumed = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i] ?? "";
    consumed += line.length + 2;
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (m && m[2] === " ") {
      const text = lines.slice(0, i + 1).map((l) => l.slice(4)).join("\n");
      return { code: Number(m[1]), text, rest: buf.slice(consumed) };
    }
  }
  return null;
}

/** DATA payload: dots at line starts are doubled, and the message ends with <CRLF>.<CRLF>. */
export function dotStuff(message: string): string {
  const body = message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return `${body}${body.endsWith("\r\n") ? "" : "\r\n"}.\r\n`;
}

export const authPlain = (user: string, pass: string): string => b64(new TextEncoder().encode(`\0${user}\0${pass}`));
export { b64 as base64Bytes };

/** Default SMTP host for an IMAP host: imap.gmail.com → smtp.gmail.com, outlook.office365.com → smtp.office365.com. */
export function guessSmtpHost(imapHost: string): string {
  const h = imapHost.trim().toLowerCase();
  if (h === "outlook.office365.com") return "smtp.office365.com";
  if (/^imap\./.test(h)) return h.replace(/^imap\./, "smtp.");
  if (/^imap-/.test(h)) return h.replace(/^imap-/, "smtp-");
  return h;
}
