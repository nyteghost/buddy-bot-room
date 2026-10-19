import { readCookie, safeEqual } from "./cookies";
import {
  SESSION_COOKIE, SESSION_SECONDS, checkPassword, hashToken, newToken, checkUsername, hashPassword, normalizeUsername, randomHex,
  readSession, signSession, toPublic, verifyPassword, type PublicUser, type StoredUser,
} from "./accounts";
import { logServer } from "./server-log.server";

/**
 * Accounts for the self-hosted build. Users live in BUDDY_DATA_DIR/users.json (PBKDF2-hashed passwords, file mode 600);
 * the session-signing secret is generated once into BUDDY_DATA_DIR/secret.key.
 * The first account becomes the owner. If BUDDY_PASSWORD is set it is the setup code for that first account.
 */
async function fs() {
  return (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
}
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const usersFile = () => `${dir()}/users.json`;

let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function readUsers(): Promise<StoredUser[]> {
  try {
    const parsed: unknown = JSON.parse(await (await fs()).readFile(usersFile(), "utf8"));
    return Array.isArray(parsed) ? (parsed as StoredUser[]).filter((u) => u && typeof u.username === "string" && typeof u.hash === "string") : [];
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return [];
    throw e;
  }
}
async function writeUsers(users: StoredUser[]): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${usersFile()}.tmp`, JSON.stringify(users), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${usersFile()}.tmp`, usersFile());
}

let secret: string | undefined;
async function sessionSecret(): Promise<string> {
  if (secret) return secret;
  const f = await fs();
  const path = `${dir()}/secret.key`;
  let value = "";
  try {
    value = (await f.readFile(path, "utf8")).trim();
  } catch (e) {
    if ((e as { code?: string }).code !== "ENOENT") throw e;
  }
  if (!value) {
    await f.mkdir(dir(), { recursive: true });
    const fresh = randomHex(32);
    try { await f.writeFile(path, fresh, { encoding: "utf8", mode: 0o600, flag: "wx" }); value = fresh; }
    catch { value = (await f.readFile(path, "utf8")).trim(); }
  }
  secret = value;
  return value;
}

/** The owner account's name (the first account), or null. Used by jobs that run without a signed-in request. */
export async function ownerName(): Promise<string | null> {
  return (await readUsers()).find((u) => u.owner)?.username ?? null;
}

export async function userCount(): Promise<number> {
  return (await readUsers()).length;
}

/** The signed-in user for this request (must still exist), or null. */
export async function currentUser(request: Request, now = Date.now()): Promise<PublicUser | null> {
  const value = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!value) return null;
  const name = await readSession(value, await sessionSecret(), now);
  if (!name) return null;
  const user = (await readUsers()).find((u) => normalizeUsername(u.username) === normalizeUsername(name));
  return user ? toPublic(user) : null;
}

const ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" };
/** A user identified by "Authorization: Bearer <access token>" (used by the iPhone Shortcut). */
export async function tokenUser(request: Request): Promise<PublicUser | null> {
  const m = /^Bearer\s+(pp_[0-9a-f]{64})$/.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!m?.[1]) return null;
  const hash = await hashToken(m[1]);
  const user = (await readUsers()).find((u) => u.tokenHash && safeEqual(u.tokenHash, hash));
  return user ? toPublic(user) : null;
}

const esc = (s: string): string => s.replace(/[<>&"']/g, (c) => ENTITIES[c] ?? "");
function page(kind: "signin" | "setup", message = "", needsCode = false): Response {
  const note = message ? `<p class="err">${esc(message)}</p>` : "";
  const body = kind === "signin"
    ? `<h1>Pixel Pals</h1>${note}<input name="username" placeholder="Username" autocomplete="username" autocapitalize="none" autofocus><input type="password" name="password" placeholder="Password" autocomplete="current-password"><button>Sign in</button>`
    : `<h1>Welcome to Pixel Pals</h1><p class="hint">Create your account. You'll be the owner and can add others later.</p>${note}<input name="username" placeholder="Choose a username" autocomplete="username" autocapitalize="none" autofocus><input type="password" name="password" placeholder="Password (8+ characters)" autocomplete="new-password"><input type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password">${needsCode ? '<input type="password" name="code" placeholder="Setup password (BUDDY_PASSWORD)">' : ""}<button>Create account</button>`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel Pals</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14121f;color:#eee;font:16px system-ui,sans-serif}
form{display:grid;gap:12px;width:min(320px,86vw)}h1{font-size:20px;margin:0}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #55507a;background:#201d33;color:#fff}
button{background:#7c6cf0;border:0;cursor:pointer}.err{color:#ff8a8a;margin:0}.hint{color:#aaa;margin:0;font-size:14px}</style>
<form method="post" action="${kind === "signin" ? "/__signin" : "/__signup"}">${body}</form>`,
    { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/** The page an unauthenticated browser sees: sign in, or first-run account creation. */
export async function authPage(message = ""): Promise<Response> {
  return (await userCount()) ? page("signin", message) : page("setup", message, !!(process.env["BUDDY_PASSWORD"] ?? "").trim());
}

const fails = new Map<string, { n: number; first: number }>();
const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;
function limited(ip: string, now: number): boolean {
  const seen = fails.get(ip);
  if (seen && now - seen.first > WINDOW_MS) fails.delete(ip);
  return (fails.get(ip)?.n ?? 0) >= MAX_FAILS;
}
function fail(ip: string, now: number) {
  const cur = fails.get(ip);
  fails.set(ip, { n: (cur?.n ?? 0) + 1, first: cur?.first ?? now });
}
const ipOf = (r: Request) => r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
const isHttps = (r: Request) => (r.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(r.url).protocol.replace(":", "")) === "https";

async function startSession(request: Request, username: string, now: number): Promise<Response> {
  const secure = isHttps(request) ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: { location: "/", "set-cookie": `${SESSION_COOKIE}=${await signSession(username, await sessionSecret(), now)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}` },
  });
}

/** /__me, /__signin, /__signup and /__logout. Returns null for any other path. */
export async function handleAccounts(request: Request, now = Date.now()): Promise<Response | null> {
  const url = new URL(request.url);
  const post = request.method === "POST";
  if (url.pathname === "/__me") {
    const user = await currentUser(request, now);
    return Response.json({ accounts: true, user }, { headers: { "cache-control": "no-store" } });
  }
  if (url.pathname === "/__logout") {
    const secure = isHttps(request) ? "; Secure" : "";
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } });
  }
  if (url.pathname === "/__signin" && post) {
    const ip = ipOf(request);
    if (limited(ip, now)) return page("signin", "Too many tries. Wait a few minutes.");
    const form = await request.formData().catch(() => null);
    const name = typeof form?.get("username") === "string" ? String(form?.get("username")).trim() : "";
    const password = typeof form?.get("password") === "string" ? String(form?.get("password")) : "";
    const user = (await readUsers()).find((u) => normalizeUsername(u.username) === normalizeUsername(name));
    // Hash even for unknown names so timing doesn't reveal which usernames exist.
    const ok = user ? await verifyPassword(password, user) : (await hashPassword(password, "00".repeat(16)), false);
    if (!user || !ok) { fail(ip, now); return page("signin", "Wrong username or password."); }
    fails.delete(ip);
    return startSession(request, user.username, now);
  }
  if (url.pathname === "/__signup" && post) {
    const ip = ipOf(request);
    if (limited(ip, now)) return page("setup", "Too many tries. Wait a few minutes.", !!(process.env["BUDDY_PASSWORD"] ?? "").trim());
    const form = await request.formData().catch(() => null);
    const get = (k: string) => (typeof form?.get(k) === "string" ? String(form?.get(k)) : "");
    const setupCode = (process.env["BUDDY_PASSWORD"] ?? "").trim();
    const again = (m: string) => page("setup", m, !!setupCode);
    if (setupCode && !safeEqual(get("code"), setupCode)) { fail(ip, now); return again("That setup password isn't right."); }
    const name = get("username").trim();
    const bad = checkUsername(name) ?? checkPassword(get("password"));
    if (bad) return again(bad);
    if (get("password") !== get("confirm")) return again("The two passwords don't match.");
    const hashed = await hashPassword(get("password"));
    const created = await locked(async () => {
      const users = await readUsers();
      if (users.length) return false;
      await writeUsers([{ username: name, ...hashed, owner: true, created: new Date(now).toISOString() }]);
      return true;
    });
    if (!created) return page("signin", "An account already exists. Sign in.");
    logServer("info", `first account created: ${name}`);
    return startSession(request, name, now);
  }
  return null;
}

/** /api/accounts: list, add, change password, remove. Owners manage everyone; others can change their own password. */
export async function handleAccountsApi(request: Request): Promise<Response> {
  const me = await currentUser(request);
  if (!me) return Response.json({ error: "Sign in first." }, { status: 401 });
  const json = (o: unknown, status = 200) => Response.json(o, { status });
  try {
    if (request.method === "GET") {
      const users = (await readUsers()).filter((u) => me.owner || normalizeUsername(u.username) === normalizeUsername(me.username));
      return json({ me, hasToken: !!(await readUsers()).find((u) => normalizeUsername(u.username) === normalizeUsername(me.username))?.tokenHash, users: users.map((u) => ({ ...toPublic(u), created: u.created })) });
    }
    const url = new URL(request.url);
    const body = request.method === "DELETE" ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    if (request.method === "POST" && body["action"] === "token") {
      const token = newToken();
      const tokenHash = await hashToken(token);
      const ok = await locked(async () => {
        const users = await readUsers();
        const i = users.findIndex((u) => normalizeUsername(u.username) === normalizeUsername(me.username));
        const user = users[i];
        if (!user) return false;
        users[i] = { ...user, tokenHash };
        await writeUsers(users);
        return true;
      });
      return ok ? json({ token }) : json({ error: "No such account." }, 404);
    }
    if (request.method === "POST") {
      if (!me.owner) return json({ error: "Only the owner can add accounts." }, 403);
      const name = typeof body["username"] === "string" ? body["username"].trim() : "";
      const bad = checkUsername(name) ?? checkPassword(body["password"]);
      if (bad) return json({ error: bad }, 400);
      const hashed = await hashPassword(String(body["password"]));
      const result = await locked(async () => {
        const users = await readUsers();
        if (users.some((u) => normalizeUsername(u.username) === normalizeUsername(name))) return "exists";
        await writeUsers([...users, { username: name, ...hashed, owner: false, created: new Date().toISOString() }]);
        return "ok";
      });
      return result === "exists" ? json({ error: "That username is taken." }, 409) : json({ ok: true });
    }
    if (request.method === "PUT") {
      const target = typeof body["username"] === "string" && body["username"] ? body["username"] : me.username;
      const self = normalizeUsername(target) === normalizeUsername(me.username);
      if (!self && !me.owner) return json({ error: "Only the owner can reset someone else's password." }, 403);
      const bad = checkPassword(body["password"]);
      if (bad) return json({ error: bad }, 400);
      const hashed = await hashPassword(String(body["password"]));
      const current = typeof body["current"] === "string" ? body["current"] : "";
      const result = await locked(async () => {
        const users = await readUsers();
        const i = users.findIndex((u) => normalizeUsername(u.username) === normalizeUsername(target));
        const user = users[i];
        if (!user) return "missing";
        if (self && !(await verifyPassword(current, user))) return "wrong";
        users[i] = { ...user, ...hashed };
        await writeUsers(users);
        return "ok";
      });
      if (result === "missing") return json({ error: "No such account." }, 404);
      if (result === "wrong") return json({ error: "Your current password isn't right." }, 403);
      return json({ ok: true });
    }
    if (request.method === "DELETE" && url.searchParams.get("token") === "1") {
      await locked(async () => {
        const users = await readUsers();
        const i = users.findIndex((u) => normalizeUsername(u.username) === normalizeUsername(me.username));
        const user = users[i];
        if (!user) return;
        const { tokenHash: _gone, ...rest } = user;
        users[i] = rest;
        await writeUsers(users);
      });
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      if (!me.owner) return json({ error: "Only the owner can remove accounts." }, 403);
      const target = url.searchParams.get("username") ?? "";
      if (normalizeUsername(target) === normalizeUsername(me.username)) return json({ error: "You can't remove your own account." }, 400);
      const removed = await locked(async () => {
        const users = await readUsers();
        const next = users.filter((u) => normalizeUsername(u.username) !== normalizeUsername(target));
        if (next.length === users.length) return false;
        await writeUsers(next);
        return true;
      });
      return removed ? json({ ok: true }) : json({ error: "No such account." }, 404);
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    logServer("error", "accounts failed", error);
    return json({ error: "The server couldn't read or write accounts. Check the buddy-data volume." }, 500);
  }
}
