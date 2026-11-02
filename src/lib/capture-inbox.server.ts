import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { currentUser } from "./accounts.server";
import { readCaptures, captureTransaction } from "./capture.server";
import {
  AUDIO_TYPES,
  MAX_AUDIO,
  inboxMeta,
  fallbackSuggestion,
  type Suggestion,
} from "./capture-inbox";
import { scrubChatText } from "./chat-scrub";
import { scheduleKeeper, foregroundStart, foregroundEnd } from "./memory-keeper.server";
import { audioRoot } from "./capture-inbox-worker.server";
import { keeperSnapshot, keeperTransaction, createMemory } from "./keeper-store.server";
import { safeId, type Scope } from "./assistant";
import { approveCaptureTask, todaySnapshot } from "./today.server";
import { calendarData } from "./inbox.server";
import { validZone } from "./schedule";
import { zoneDateKey } from "./day-overview";
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const clean = (v: unknown, n: number) =>
  typeof v === "string" ? scrubChatText(v).trim().slice(0, n) : "";
async function bodyBytes(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > limit) {
        await reader.cancel();
        throw Error("Input too large");
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}
export async function homeOverview(zone: string, now = Date.now()) {
  const [state, memory, captures, calendar] = await Promise.all([
    todaySnapshot(),
    keeperSnapshot(),
    readCaptures(),
    Promise.race([
      calendarData(1).catch(() => null),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 2500);
        timer.unref?.();
      }),
    ]),
  ]);
  const day = zoneDateKey(now, zone);
  const tasks = state.tasks.filter((t) => t.status === "open");
  const eligible = tasks.filter((t) => !t.at || zoneDateKey(t.at, zone) <= day);
  const priorities = [...eligible]
    .sort(
      (a, b) =>
        Number(b.tier === "must") - Number(a.tier === "must") ||
        (a.at ?? Infinity) - (b.at ?? Infinity) ||
        a.createdAt - b.createdAt,
    )
    .slice(0, 3);
  const events =
    calendar?.items
      .filter((e) => e.end > now && zoneDateKey(e.start, zone) === day)
      .sort((a, b) => a.start - b.start) ?? [];
  const ideas = memory.records
    .filter((m) => m.status === "active" && m.scope === "global" && m.category === "idea")
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.updated.localeCompare(b.updated))
    .slice(0, 3);
  return {
    day,
    zone,
    priorities,
    taskCount: tasks.length,
    pendingCaptures: captures.filter((c) => c.inbox?.status === "pending").length,
    nextEvent: events[0]
      ? { title: scrubChatText(events[0].title), start: events[0].start, allDay: events[0].allDay }
      : null,
    calendarAvailable: !!calendar?.configured,
    idea: ideas[0]
      ? {
          id: ideas[0].id,
          title: ideas[0].title,
          text: ideas[0].text,
          reason: "A global idea you saved for later.",
        }
      : null,
    weekly: {
      completed: state.tasks.filter(
        (t) => t.status === "done" && (t.doneAt ?? 0) >= now - 7 * 86400000,
      ).length,
      lingering: tasks.filter((t) => t.createdAt < now - 7 * 86400000).slice(0, 5),
      ideas: ideas.map((m) => ({ id: m.id, title: m.title, text: m.text })),
    },
  };
}
export async function handleCaptureInbox(req: Request): Promise<Response> {
  if (!process.env["BUDDY_DATA_DIR"]?.trim())
    return reply({ error: "Persistent storage is required." }, 404);
  const user = await currentUser(req);
  if (!user?.owner) return reply({ error: "Owner sign-in required." }, 403);
  let foreground = false;
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.searchParams.get("view") === "brief")
        return reply(
          await homeOverview(
            validZone(process.env["BUDDY_TZ"]) ??
              validZone(url.searchParams.get("tz") ?? "") ??
              "UTC",
          ),
        );
      const rows = await readCaptures();
      const id = url.searchParams.get("audio");
      if (id) {
        const row = rows.find((r) => r.id === id);
        if (!row?.inbox?.audio) return reply({ error: "Recording not found" }, 404);
        const audio = row.inbox.audio;
        return new Response(await fs.readFile(audioRoot() + "/" + audio.name), {
          headers: {
            "Content-Type": audio.type,
            "Cache-Control": "no-store",
            "Content-Disposition": 'inline; filename="capture.' + AUDIO_TYPES[audio.type] + '"',
          },
        });
      }
      const memory = await keeperSnapshot();
      return reply({
        items: rows.filter((r) => r.inbox).sort((a, b) => b.at - a.at),
        projects: memory.projects,
        enabled:
          process.env["MEMORY_KEEPER_ENABLED"] !== "off" &&
          process.env["CAPTURE_AUTO_PROCESS"] !== "off",
        voiceConfigured: !!process.env["WHISPER_URL"]?.trim(),
        limit: 100,
        maxAudio: MAX_AUDIO,
      });
    }
    if (req.method !== "POST") return reply({ error: "Unsupported operation" }, 405);
    await foregroundStart();
    foreground = true;
    const type = (req.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
    if (AUDIO_TYPES[type]) {
      const bytes = await bodyBytes(req, MAX_AUDIO);
      if (!bytes.length) return reply({ error: "Empty recording" }, 400);
      const id = randomUUID(),
        name = id + "." + AUDIO_TYPES[type];
      const root = audioRoot();
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      if ((await fs.lstat(root)).isSymbolicLink()) throw Error("Unsafe audio folder");
      await fs.writeFile(root + "/" + name, bytes, { mode: 0o600, flag: "wx" });
      try {
        await captureTransaction((rows) => {
          if (rows.length >= 100)
            throw Error("Capture limit reached. Review or remove old captures first.");
          const inbox = inboxMeta("", "audio");
          inbox.audio = { name, type, bytes: bytes.length };
          rows.push({
            id,
            kind: "note",
            text: "Voice memo waiting for local transcription.",
            at: Date.now(),
            inbox,
          });
        });
      } catch (e) {
        await fs.unlink(root + "/" + name);
        throw e;
      }
      scheduleKeeper(1000);
      return reply({ ok: true, id });
    }
    const data = JSON.parse(new TextDecoder().decode(await bodyBytes(req, 32000))) as Record<
      string,
      unknown
    >;
    if (data["op"] === "add") {
      if (typeof data["text"] === "string" && data["text"].length > 4000)
        throw Error("Capture text is too long. Split it into smaller captures.");
      const text = clean(data["text"], 4000);
      if (!text) return reply({ error: "Type a thought to capture" }, 400);
      const id = typeof data["id"] === "string" && safeId(data["id"]) ? data["id"] : randomUUID();
      await captureTransaction((rows) => {
        const old = rows.find((r) => r.id === id);
        if (old) {
          if (old.text !== text) throw Error("Capture changed; reload before saving.");
          return;
        }
        if (rows.length >= 100)
          throw Error("Capture limit reached. Review or remove old captures first.");
        rows.push({ id, kind: "note", text, at: Date.now(), inbox: inboxMeta(text) });
      });
      scheduleKeeper(1000);
      return reply({ ok: true, id });
    }
    const result = await captureTransaction(async (rows) => {
      const index = rows.findIndex((r) => r.id === data["id"] && r.inbox);
      const row = rows[index];
      if (!row?.inbox) throw Error("Capture not found");
      const meta = row.inbox;
      if (data["revision"] !== meta.revision)
        throw Error("Capture changed; reload before saving. Your edits are kept.");
      if (data["op"] === "delete") {
        rows.splice(index, 1);
        if (meta.audio) await fs.unlink(audioRoot() + "/" + meta.audio.name).catch(() => undefined);
        return { ok: true };
      }
      if (data["op"] === "archive") {
        meta.status = "archived";
        meta.job.state = "done";
        meta.revision++;
        if (meta.audio) {
          await fs.unlink(audioRoot() + "/" + meta.audio.name).catch(() => undefined);
          delete meta.audio;
        }
        return { ok: true };
      }
      if (data["op"] === "retry") {
        if (meta.status !== "pending") throw Error("Only pending captures can be processed");
        meta.job = { state: "pending", attempts: 0, next: 0, note: "Queued for local processing" };
        meta.revision++;
        return { ok: true };
      }
      if (data["op"] === "pause") {
        meta.job.state = "done";
        meta.job.note = "Manual review; background suggestions paused.";
        meta.revision++;
        return { item: row };
      }
      if (data["op"] === "transcript") {
        if (meta.approved.length)
          throw Error("A reviewed capture cannot be rewritten. Create a new capture.");
        const text = clean(data["text"], 4000);
        if (!text) throw Error("Transcript cannot be empty");
        row.text = text;
        meta.suggestions = fallbackSuggestion(text);
        meta.job.state = "done";
        meta.revision++;
        return { item: row };
      }
      if (data["op"] !== "approve") throw Error("Unknown capture operation");
      const suggestion = meta.suggestions.find((s) => s.id === data["suggestion"]);
      if (!suggestion) throw Error("Suggestion not found");
      const done = meta.approved.find((a) => a.id === suggestion.id);
      if (done) return { ok: true, target: done.target };
      const kind = data["kind"];
      const text = clean(data["text"], 400);
      if (!text || !["task", "idea", "memory"].includes(String(kind)))
        throw Error("Review a valid suggestion first");
      const step = clean(data["firstStep"], 300);
      const materials = Array.isArray(data["materials"])
        ? data["materials"]
            .map((m) => clean(m, 100))
            .filter(Boolean)
            .slice(0, 8)
        : [];
      const minutes =
        typeof data["minutes"] === "number" && Number.isFinite(data["minutes"])
          ? Math.max(1, Math.min(180, Math.round(data["minutes"])))
          : null;
      let target = "";
      if (kind === "task") {
        const task = await approveCaptureTask(
          row.id,
          suggestion.id,
          text,
          [
            step ? `First step: ${step}` : "",
            materials.length ? "Materials: " + materials.join(", ") : "",
            `Source capture: ${row.id}`,
          ]
            .filter(Boolean)
            .join("\n"),
          minutes,
        );
        target = task.id;
      } else {
        const scope =
          data["scope"] === "global"
            ? "global"
            : data["scope"] === "project"
              ? "project"
              : "private";
        const project = clean(data["project"], 80);
        target = await keeperTransaction((state) => {
          if (scope === "project" && !state.projects.some((p) => p.id === project))
            throw Error("Choose an existing project");
          const old = state.records.find(
            (m) => m.origin?.capture === row.id && m.origin.suggestion === suggestion.id,
          );
          if (old) {
            if (old.status === "deleted")
              throw Error(
                "This memory was deleted; create a new capture for intentional re-entry.",
              );
            return old.id;
          }
          const memory = createMemory(state, {
            title: text.slice(0, 120),
            text,
            scope: scope as Scope,
            project: scope === "project" ? project : "",
            verified: true,
            sources: [{ conversation: "capture-inbox", message: row.id, quote: suggestion.quote }],
            key: "capture " + row.id + " " + suggestion.id,
          });
          if (!memory) throw Error("Memory could not be saved");
          memory.category = kind === "idea" ? "idea" : "fact";
          memory.origin = { capture: row.id, suggestion: suggestion.id };
          return memory.id;
        });
      }
      Object.assign(suggestion, {
        kind: kind as Suggestion["kind"],
        text,
        firstStep: step,
        materials,
        minutes,
      });
      meta.approved.push({ id: suggestion.id, kind: String(kind), target });
      meta.status = meta.suggestions.every((s) => meta.approved.some((a) => a.id === s.id))
        ? "reviewed"
        : "pending";
      meta.job.state = "done";
      meta.revision++;
      return { ok: true, target, kind, text, firstStep: step };
    });
    if (data["op"] === "retry") scheduleKeeper(1);
    return reply(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return reply(
      {
        error:
          /Input too large|Capture|capture|Choose|Review|reviewed|Transcript|Suggestion|Only pending|memory was deleted|Task limit|Today task limit/.test(
            message,
          )
            ? message
            : "Capture storage or processing failed. Existing data was kept.",
      },
      /changed/.test(message) ? 409 : /too large/.test(message) ? 413 : 400,
    );
  } finally {
    if (foreground) foregroundEnd();
  }
}
