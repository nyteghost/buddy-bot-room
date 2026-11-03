import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { mkdir, lstat, readFile, readdir, rename, rm, open, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { currentUser } from "./accounts.server";
import { MEETING_TYPES, MEETING_CHUNK_BYTES, MEETING_MAX_COUNT, meetingId, newMeeting, parseMeetingMeta, partLength, sha256Hex, type MeetingRecord } from "./meeting-vault";

const base = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const root = () => join(base(), "meeting-vault");
const folder = (id: string) => join(root(), id);
const metaPath = (id: string) => join(folder(id), "record.json");
const chunksPath = (id: string) => join(folder(id), "chunks");
const chunkPath = (id: string, part: number) => join(chunksPath(id), String(part).padStart(4, "0") + ".part");
const audioPath = (record: MeetingRecord) => join(folder(record.id), "original." + MEETING_TYPES[record.mimeType]);
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work, work);
  chain = run.catch(() => undefined);
  return run;
};
async function secureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe Meeting Vault directory");
  await chmod(path, 0o700);
}
async function readMeeting(id: string): Promise<MeetingRecord> {
  if (!meetingId(id)) throw Error("Invalid meeting ID");
  const dir = await lstat(folder(id));
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error("Unsafe meeting folder");
  const stat = await lstat(metaPath(id));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw Error("Invalid meeting metadata");
  const record = parseMeetingMeta(JSON.parse(await readFile(metaPath(id), "utf8")));
  if (!record || record.id !== id) throw Error("Invalid meeting record");
  return record;
}
/** Internal-only source lookup. HTTP callers must pass the owner-session gate first. */
export async function meetingSourceForReview(id: string): Promise<MeetingRecord> {
  const record = await readMeeting(id);
  if (record.status !== "ready") throw Error("Finish uploading the original recording first");
  return record;
}
async function storeMeeting(record: MeetingRecord): Promise<void> {
  const tmp = metaPath(record.id) + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    await rename(tmp, metaPath(record.id));
  } finally { await rm(tmp, { force: true }).catch(() => undefined); }
}
async function listMeetings(): Promise<MeetingRecord[]> {
  await secureDir(root());
  const names = (await readdir(root(), { withFileTypes: true }))
    .filter(x => x.isDirectory() && meetingId(x.name)).map(x => x.name);
  if (names.length > MEETING_MAX_COUNT) throw Error("Meeting Vault is over its capacity");
  const records: MeetingRecord[] = [];
  for (const id of names) records.push(await readMeeting(id));
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function bytesFrom(request: Request, max: number): Promise<Buffer> {
  const reported = Number(request.headers.get("content-length") ?? "0");
  if (reported > max) throw Error("Audio part too large");
  if (!request.body) throw Error("Missing audio bytes");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) throw Error("Audio part too large");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
async function receivePart(request: Request, id: string, part: number): Promise<Response> {
  const checksum = (request.headers.get("x-chunk-sha256") ?? "").toLowerCase();
  if (!sha256Hex(checksum)) return reply({ error: "A SHA-256 checksum is required for every part" }, 400);
  return locked(async () => {
    const record = await readMeeting(id);
    if (record.status !== "uploading" || !Number.isInteger(part) || part < 0 || part >= record.parts)
      return reply({ error: "This recording cannot accept that part" }, 409);
    const expected = partLength(record, part);
    const chunk = await bytesFrom(request, MEETING_CHUNK_BYTES);
    const actual = createHash("sha256").update(chunk).digest("hex");
    if (chunk.length !== expected || actual !== checksum)
      return reply({ error: "Audio part size or checksum mismatch. Retry it." }, 422);
    await secureDir(chunksPath(id));
    const target = chunkPath(id, part);
    const existing = await lstat(target).catch(e => {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    });
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== expected ||
          createHash("sha256").update(await readFile(target)).digest("hex") !== checksum)
        return reply({ error: "That part differs from the original file. Reselect the original recording." }, 409);
    } else {
      const tmp = target + "." + randomUUID() + ".tmp";
      try {
        await writeFile(tmp, chunk, { mode: 0o600, flag: "wx" });
        await rename(tmp, target);
      } finally { await rm(tmp, { force: true }).catch(() => undefined); }
    }
    if (!record.received.includes(part)) {
      record.received.push(part);
      record.received.sort((a, b) => a - b);
      record.updatedAt = new Date().toISOString();
      record.revision++;
      await storeMeeting(record);
    }
    return reply({ ok: true, parts: record.parts, received: record.received.length });
  });
}
async function fileHash(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const b of createReadStream(filename)) hash.update(b as Buffer);
  return hash.digest("hex");
}
async function completeMeeting(id: string): Promise<Response> {
  return locked(async () => {
    const record = await readMeeting(id);
    if (record.status === "ready") return reply({ record, alreadyComplete: true });
    if (record.received.length !== record.parts)
      return reply({ error: "Upload incomplete. Reselect the original file to resume." }, 409);
    const destination = audioPath(record);
    const temporary = join(folder(id), "original." + randomUUID() + ".tmp");
    const hash = createHash("sha256");
    let size = 0;
    const output = await open(temporary, "wx", 0o600);
    let good = false;
    try {
      for (let part = 0; part < record.parts; part++) {
        if (!record.received.includes(part)) throw Error("Audio part missing");
        const filename = chunkPath(id, part);
        const stat = await lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== partLength(record, part))
          throw Error("Audio part was modified");
        const bytes = await readFile(filename);
        hash.update(bytes);
        size += bytes.length;
        await output.writeFile(bytes);
      }
      await output.sync();
      if (size !== record.bytes) throw Error("Original audio size mismatch");
      good = true;
    } finally {
      await output.close();
      if (!good) await rm(temporary, { force: true }).catch(() => undefined);
    }
    const digest = hash.digest("hex");
    const previous = await lstat(destination).catch(e => {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    });
    if (previous) {
      if (!previous.isFile() || previous.isSymbolicLink() || previous.size !== record.bytes ||
          await fileHash(destination) !== digest) throw Error("Original audio conflicts with existing recording");
      await rm(temporary, { force: true });
    } else await rename(temporary, destination);
    record.sha256 = digest;
    record.status = "ready";
    record.updatedAt = new Date().toISOString();
    record.revision++;
    await storeMeeting(record);
    await rm(chunksPath(id), { recursive: true, force: true }).catch(() => undefined);
    return reply({ record });
  });
}
async function streamAudio(request: Request, record: MeetingRecord): Promise<Response> {
  if (record.status !== "ready") return reply({ error: "Original audio is not ready" }, 409);
  const file = audioPath(record);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.bytes)
    throw Error("Original audio is missing or has changed");
  let start = 0, end = stat.size - 1, status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + stat.size } });
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return new Response(null, { status: 416 });
      start = Math.max(0, stat.size - suffix);
    } else start = Number(match[1]);
    end = match[1] && match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size)
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + stat.size } });
    end = Math.min(end, stat.size - 1);
    status = 206;
  }
  const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers: {
    "Content-Type": record.mimeType === "audio/x-m4a" ? "audio/mp4" : record.mimeType,
    "Content-Disposition": "inline; filename=\"meeting-original\"",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ...(status === 206 ? { "Content-Range": "bytes " + start + "-" + end + "/" + stat.size } : {}),
  } });
}
/** Owner-authenticated REST API. No token shortcut or Discord access to meeting files. */
export async function handleMeetingVault(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return reply({ error: "Only the Pixel Pals owner can access Meeting Vault" }, 403);
  if (!base()) return reply({ error: "Meeting Vault needs the Unraid persistent data directory" }, 503);
  const url = new URL(request.url);
  try {
    if (request.method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      if (url.searchParams.get("audio") === "1") {
        if (!meetingId(id)) return reply({ error: "Invalid meeting ID" }, 400);
        return streamAudio(request, await readMeeting(id));
      }
      return reply({ meetings: await locked(listMeetings) });
    }
    if (request.method === "PUT") {
      const id = url.searchParams.get("id") ?? "";
      const partText = url.searchParams.get("part") ?? "";
      if (!meetingId(id) || !/^\d+$/.test(partText)) return reply({ error: "Invalid meeting or part" }, 400);
      return receivePart(request, id, Number(partText));
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body["op"] === "create") {
      const record = newMeeting(body, randomUUID(), new Date().toISOString());
      if (!record) return reply({ error: "Choose supported audio under 512 MB and confirm recording/storage permission." }, 400);
      return locked(async () => {
        const list = await listMeetings();
        if (list.length >= MEETING_MAX_COUNT) return reply({ error: "Meeting Vault is full; review older recordings." }, 409);
        // Publish the new recording directory atomically. A crash while
        // creating metadata must not strand an empty UUID folder that breaks listing.
        const pending = join(root(), ".creating-" + record.id);
        await secureDir(pending);
        try {
          await writeFile(join(pending, "record.json"), JSON.stringify(record),
            { mode: 0o600, flag: "wx" });
          await rename(pending, folder(record.id));
        } catch (error) {
          await rm(pending, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
        return reply({ record }, 201);
      });
    }
    const id = typeof body["id"] === "string" ? body["id"] : "";
    if (!meetingId(id)) return reply({ error: "Invalid meeting ID" }, 400);
    if (body["op"] === "finalize") return completeMeeting(id);
    if (body["op"] === "remove") {
      if (body["confirm"] !== true) return reply({ error: "Deleting original audio requires explicit confirmation" }, 400);
      return locked(async () => {
        const record = await readMeeting(id);
        if (body["revision"] !== record.revision) return reply({ error: "Meeting changed; refresh before deleting." }, 409);
        await rm(folder(id), { recursive: true, force: true });
        return reply({ ok: true });
      });
    }
    return reply({ error: "Unknown Meeting Vault operation" }, 400);
  } catch {
    return reply({ error: "Meeting Vault couldn't complete this request. Check the original file and Unraid storage." }, 500);
  }
}
