import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { promises as fs } from "node:fs";
import { join } from "node:path";

/** Protect the owner-only ICS subscription service from fetching local infrastructure or URL credentials. */
const MAX_BYTES = 8_000_000;
const MAX_CACHE_AGE = 30 * 86400_000;
type Snapshot = { savedAt: number; body: string };
export type CalendarFeedSnapshot = { text: string; syncedAt: number; stale: boolean; cached: boolean; warning?: string };

export function publicCalendarAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  // A DNS name must be checked against every returned A and AAAA record.
  if (isIP(ip) === 4) {
    const v = ip.split(".").map(Number);
    const [a=0,b=0,c=0] = v;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) !== 6) return false;
  // Deny unspecified, loopback, ULA, link-local, multicast, IPv4-mapped and transition ranges.
  if (ip === "::" || ip === "::1" || ip.startsWith("fe8") || ip.startsWith("fe9") ||
      ip.startsWith("fea") || ip.startsWith("feb") || ip.startsWith("fc") || ip.startsWith("fd") ||
      ip.startsWith("ff") || ip.startsWith("::ffff:") || ip.startsWith("2002:") ||
      ip.startsWith("2001:db8:") || ip.startsWith("64:ff9b:")) return false;
  return true;
}

export async function safeCalendarUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = async host => (await lookup(host, { all: true })).map(x => x.address),
): Promise<string> {
  if (raw.length > 2500) throw Error("Calendar link is too long");
  let url: URL;
  try { url = new URL(raw.replace(/^webcal:/i, "https:")); }
  catch { throw Error("Invalid calendar link"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      !host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      isIP(host) || url.hash) throw Error("Calendar links must be public HTTPS addresses without embedded credentials");
  let answers: string[];
  try { answers = await resolve(host); }
  catch { throw Error("Calendar address could not be verified"); }
  if (!answers.length || answers.some(a => !publicCalendarAddress(a)))
    throw Error("Calendar address is not a public internet host");
  return url.toString();
}
const digest = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 40);
const root = () => (process.env["BUDDY_DATA_DIR"] || "").replace(/\/+$/, "");
const cachePath = (url: string) => root() ? join(root(), "calendar-cache", digest(url) + ".json") : null;
async function readCache(url: string, now: number): Promise<Snapshot | null> {
  const path = cachePath(url);
  if (!path) return null;
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES + 300) return null;
    const data = JSON.parse(await fs.readFile(path, "utf8")) as Snapshot;
    if (typeof data.savedAt !== "number" || typeof data.body !== "string" ||
      data.body.length > MAX_BYTES || !data.body.includes("BEGIN:VCALENDAR") ||
      data.savedAt > now + 60_000 || now - data.savedAt > MAX_CACHE_AGE) return null;
    return data;
  } catch { return null; }
}
async function saveCache(url: string, snapshot: Snapshot): Promise<void> {
  const path = cachePath(url);
  if (!path) return;
  const directory = join(root(), "calendar-cache");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const dirStat = await fs.lstat(directory);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw Error("Unsafe calendar cache directory");
  const tmp = path + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, path);
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}
export async function fetchCalendarSnapshot(url: string, force = false, now = Date.now()): Promise<CalendarFeedSnapshot> {
  const cached = await readCache(url, now);
  const interval = Math.min(24*60, Math.max(5, Number(process.env["CALENDAR_REFRESH_MINUTES"]) || 30)) * 60_000;
  if (!force && cached && now - cached.savedAt < interval) {
    return { text: cached.body, syncedAt: cached.savedAt, stale: false, cached: true };
  }
  try {
    const safe = await safeCalendarUrl(url);
    // Redirects are forbidden. Never follow a provider redirect to LAN addresses.
    const res = await fetch(safe, { redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Accept: "text/calendar" } });
    if (!res.ok) throw Error("HTTP " + res.status);
    if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) throw Error("Calendar file too large");
    const reader = res.body?.getReader();
    if (!reader) throw Error("Calendar feed returned no body");
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw Error("Calendar file too large");
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = new TextDecoder().decode(Buffer.concat(parts));
    if (!body.includes("BEGIN:VCALENDAR") || !body.includes("END:VCALENDAR")) throw Error("Not a calendar file");
    // Cache persistence failure should not discard an otherwise successful sync.
    await saveCache(url, { savedAt: now, body }).catch(() => {});
    return { text: body, syncedAt: now, stale: false, cached: false };
  } catch {
    if (cached) return { text: cached.body, syncedAt: cached.savedAt, stale: true, cached: true, warning: "Using the last successful calendar snapshot; refresh failed." };
    throw Error("Calendar feed unavailable, invalid, or blocked for safety");
  }
}
