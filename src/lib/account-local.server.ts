import { currentUser } from "./accounts.server";
import { accountFileName, normalizeAccountData } from "./local-account";
import { logServer } from "./server-log.server";

/**
 * Per-account settings for the self-hosted build: one small JSON file per account in
 * BUDDY_DATA_DIR/accounts (mode 600). Only works for a signed-in, allowed Google user.
 * Keys are stored as typed on your own server's volume (not encrypted), same trust level as the data volume.
 */
async function fs() {
  return (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
}
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");

export async function handleAccountLocal(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!dir()) return Response.json({ error: "No data folder: BUDDY_DATA_DIR isn't set, so settings can't be saved on the server." }, { status: 503 });
  const f = await fs();
  const folder = `${dir()}/accounts`;
  const path = `${folder}/${await accountFileName(user.username)}`;
  try {
    if (request.method === "GET") {
      try {
        return Response.json({ data: normalizeAccountData(JSON.parse(await f.readFile(path, "utf8")))?.data ?? null });
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") return Response.json({ data: null });
        throw e;
      }
    }
    if (request.method === "PUT") {
      const text = await request.text();
      if (text.length > 2_000_000) return Response.json({ error: "Your settings are too large to sync (documents are the usual cause)." }, { status: 413 });
      const settings = normalizeAccountData(JSON.parse(text));
      if (!settings) return Response.json({ error: "Those settings weren't valid." }, { status: 400 });
      await f.mkdir(folder, { recursive: true, mode: 0o700 });
      await f.writeFile(`${path}.tmp`, JSON.stringify(settings), { encoding: "utf8", mode: 0o600 });
      await f.rename(`${path}.tmp`, path);
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    logServer("error", "account settings store failed", error);
    return Response.json({ error: "The server couldn't read or write your settings. Check the buddy-data volume." }, { status: 500 });
  }
}
