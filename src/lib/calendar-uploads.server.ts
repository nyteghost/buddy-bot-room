import { readFile, writeFile, rename, mkdir, lstat, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { currentUser } from "./accounts.server";
type Snapshot = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  revision: number;
  imported: string;
  digest: string;
  body: string;
};
const root = () => process.env["BUDDY_DATA_DIR"]?.trim();
let queue: Promise<unknown> = Promise.resolve();
export async function calendarUploads(): Promise<Snapshot[]> {
  if (!root()) return [];
  try {
    const info = await lstat(root() + "/calendar-uploads.json");
    if (!info.isFile() || info.isSymbolicLink() || info.size > 49000000)
      throw Error("Invalid calendar storage");
    const rows: unknown = JSON.parse(await readFile(root() + "/calendar-uploads.json", "utf8"));
    if (
      !Array.isArray(rows) ||
      rows.length > 8 ||
      !rows.every(
        (s) =>
          s &&
          /^[0-9a-f-]{36}$/.test(s.id) &&
          typeof s.name === "string" &&
          s.name.length <= 80 &&
          /^#[0-9a-f]{6}$/i.test(s.color) &&
          typeof s.enabled === "boolean" &&
          Number.isSafeInteger(s.revision) &&
          s.revision > 0 &&
          typeof s.imported === "string" &&
          typeof s.digest === "string" &&
          typeof s.body === "string" &&
          Buffer.byteLength(s.body) <= 1000000 &&
          s.body.includes("BEGIN:VCALENDAR"),
      )
    )
      throw Error("Invalid stored calendar snapshots");
    return rows;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function handleCalendarUploads(request: Request): Promise<Response> {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!(await currentUser(request))?.owner) return reply({ error: "Owner sign-in required" }, 403);
  if (!root()) return reply({ error: "Persistent data volume required" }, 503);
  const publicRows = (rows: Snapshot[]) =>
    rows.map(({ body: _, ...s }) => {
      void _;
      return s;
    });
  try {
    if (request.method === "GET") return reply({ snapshots: publicRows(await calendarUploads()) });
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Missing request" }, 400);
    let bytes = 0,
      raw = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value.byteLength;
        if (bytes > 6100000) return reply({ error: "Upload too large" }, 413);
        raw += decoder.decode(r.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const data = JSON.parse(raw) as Record<string, unknown>;
    const run = async () => {
      const rows = await calendarUploads();
      if (data["op"] === "import") {
        if (data["confirm"] !== true)
          return reply({ error: "Confirm permission to import this calendar" }, 400);
        const body = typeof data["body"] === "string" ? data["body"] : "";
        const name = typeof data["name"] === "string" ? data["name"].trim() : "";
        const color = typeof data["color"] === "string" ? data["color"] : "#93d9b6";
        if (
          !name ||
          name.length > 80 ||
          !/^#[0-9a-f]{6}$/i.test(color) ||
          Buffer.byteLength(body) > 1000000 ||
          !body.includes("BEGIN:VCALENDAR") ||
          !body.includes("END:VCALENDAR")
        )
          return reply({ error: "Choose a named .ics calendar up to 1 MB and a valid color" }, 400);
        const digest = createHash("sha256").update(body).digest("hex");
        if (rows.some((s) => s.digest === digest && s.name === name))
          return reply({ snapshots: publicRows(rows) });
        if (rows.length >= 8)
          return reply(
            { error: "Eight snapshots are already retained. No older calendar was deleted." },
            409,
          );
        rows.push({
          id: randomUUID(),
          name,
          color,
          body,
          digest,
          enabled: true,
          revision: 1,
          imported: new Date().toISOString(),
        });
      } else if (data["op"] === "visibility") {
        const row = rows.find((s) => s.id === data["id"] && s.revision === data["revision"]);
        if (!row) return reply({ error: "Calendar changed; refresh before editing" }, 409);
        if (typeof data["enabled"] !== "boolean")
          return reply({ error: "Choose calendar visibility" }, 400);
        row.enabled = data["enabled"];
        row.revision++;
      } else return reply({ error: "Unsupported operation" }, 400);
      await mkdir(root()!, { recursive: true, mode: 0o700 });
      const file = root() + "/calendar-uploads.json",
        temp = file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temp, JSON.stringify(rows), { mode: 0o600, flag: "wx" });
        await rename(temp, file);
      } finally {
        await rm(temp, { force: true }).catch(() => undefined);
      }
      return reply({ snapshots: publicRows(rows) });
    };
    const pending = queue.then(run, run);
    queue = pending.catch(() => undefined);
    return await pending;
  } catch {
    return reply(
      { error: "Calendar snapshots could not be read or saved. Existing data was kept." },
      400,
    );
  }
}
