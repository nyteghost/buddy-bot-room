/** Built-in accounts for the self-hosted build: validation, password hashing and signed sessions. Pure (Web Crypto only). */
export type StoredUser = { username: string; salt: string; hash: string; iter: number; owner: boolean; created: string };
export type PublicUser = { username: string; owner: boolean };

export const SESSION_COOKIE = "buddy_session";
export const SESSION_SECONDS = 30 * 24 * 3600;
const ITER = 210_000;

const enc = (s: string) => new TextEncoder().encode(s);
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (p) => parseInt(p, 16));
export const randomHex = (n = 16): string => toHex(crypto.getRandomValues(new Uint8Array(n)));
const toB64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function checkUsername(v: unknown): string | null {
  if (typeof v !== "string" || !/^[A-Za-z0-9_.-]{2,32}$/.test(v)) return "Usernames are 2–32 letters, numbers, dots, dashes or underscores.";
  return null;
}
export function checkPassword(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 8) return "Passwords need at least 8 characters.";
  if (v.length > 200) return "That password is too long.";
  return null;
}
export const normalizeUsername = (u: string): string => u.trim().toLowerCase();

export async function hashPassword(password: string, salt = randomHex(16), iter = ITER): Promise<{ salt: string; hash: string; iter: number }> {
  const key = await crypto.subtle.importKey("raw", enc(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: fromHex(salt), iterations: iter }, key, 512);
  return { salt, hash: toHex(new Uint8Array(bits)), iter };
}

function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function verifyPassword(password: string, user: Pick<StoredUser, "salt" | "hash" | "iter">): Promise<boolean> {
  return same((await hashPassword(password, user.salt, user.iter)).hash, user.hash);
}

async function mac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc(`pixel-pals-session:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toB64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc(data))));
}

export async function signSession(username: string, secret: string, now = Date.now()): Promise<string> {
  const payload = toB64u(enc(JSON.stringify({ u: username, x: Math.floor(now / 1000) + SESSION_SECONDS })));
  return `${payload}.${await mac(secret, payload)}`;
}

/** The username a valid, unexpired session cookie was issued to. The caller still checks the user exists. */
export async function readSession(value: string, secret: string, now = Date.now()): Promise<string | null> {
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!same(await mac(secret, parts[0]), parts[1])) return null;
  try {
    const bin = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((parts[0].length + 3) % 4));
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as Record<string, unknown>;
    return typeof p["u"] === "string" && typeof p["x"] === "number" && p["x"] * 1000 >= now ? p["u"] : null;
  } catch { return null; }
}

export const toPublic = (u: StoredUser): PublicUser => ({ username: u.username, owner: u.owner });

/** True when accounts are on: a data folder exists (Docker) and BUDDY_ACCOUNTS isn't "0". */
export function accountsEnabled(env: Record<string, string | undefined>): boolean {
  return !!(env["BUDDY_DATA_DIR"] ?? "").trim() && (env["BUDDY_ACCOUNTS"] ?? "").trim() !== "0";
}
