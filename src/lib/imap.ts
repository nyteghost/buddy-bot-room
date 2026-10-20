/** Pure helpers for reading message headers over IMAP (no bodies are ever requested). */
export type MailHeader = { from: string; subject: string; date: string };

function decodeBytes(bytes: number[], charset: string): string {
  try { return new TextDecoder(/^(utf-?8|us-ascii)$/i.test(charset) ? "utf-8" : charset.toLowerCase()).decode(new Uint8Array(bytes)); } catch { return String.fromCharCode(...bytes); }
}

/** "=?UTF-8?B?...?=" and "=?ISO-8859-1?Q?...?=" → plain text. */
export function decodeMimeWords(input: string): string {
  const joined = input.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
    try {
      if (enc.toUpperCase() === "B") return decodeBytes([...atob(text)].map((c) => c.charCodeAt(0)), charset);
      const bytes: number[] = [];
      const t = text.replace(/_/g, " ");
      for (let i = 0; i < t.length; i++) {
        if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
        else bytes.push(t.charCodeAt(i) & 0xff);
      }
      return decodeBytes(bytes, charset);
    } catch { return text; }
  });
}

/** Display name from a From header: `"Ann Lee" <a@x.test>` → `Ann Lee`; a bare address stays as is. */
export function senderName(from: string): string {
  const d = decodeMimeWords(from).trim();
  const named = /^"?([^"<]+?)"?\s*<[^>]*>$/.exec(d);
  return (named?.[1] ?? d.replace(/[<>]/g, "")).trim().slice(0, 60) || "Unknown";
}

export function parseHeaderBlock(block: string): MailHeader {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const get = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "im").exec(unfolded)?.[1]?.trim() ?? "";
  return { from: senderName(get("From")), subject: decodeMimeWords(get("Subject")).slice(0, 140) || "(no subject)", date: get("Date") };
}

/** Pulls each `* n FETCH (... {len}\r\n<len bytes>)` out of a raw IMAP reply. The text must be latin1-decoded so lengths are bytes. */
export function parseFetchHeaders(raw: string): MailHeader[] {
  const out: MailHeader[] = [];
  const re = /\* \d+ FETCH \([^{]*\{(\d+)\}\r\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const len = Number(m[1]);
    const start = m.index + m[0].length;
    out.push(parseHeaderBlock(raw.slice(start, start + len)));
    re.lastIndex = start + len;
  }
  return out;
}

/** Message numbers from "* SEARCH 4 9 12". */
export function parseSearch(raw: string): number[] {
  const m = /^\* SEARCH ?([\d ]*)\r?$/m.exec(raw);
  return (m?.[1] ?? "").split(" ").map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/** Quoted-string for LOGIN; null when the value can't be sent safely. */
export function imapQuote(v: string): string | null {
  return /[\r\n\0]/.test(v) ? null : `"${v.replace(/[\\"]/g, "\\$&")}"`;
}

export const validFolder = (f: string): boolean => /^[\w .\/-]{1,60}$/.test(f);
