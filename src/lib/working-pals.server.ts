import { scrubChatText } from "./chat-scrub";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { currentUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { jobs } from "./jobs.server";
import {
  canRun,
  MAX_MISSIONS,
  newMission,
  recoverMission,
  validMission,
  type PalMission,
} from "./working-pals";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const path = () => dir() + "/working-pals.json";
const launching = new Set<string>();
let chain: Promise<unknown> = Promise.resolve();
const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const pending = chain.then(task, task);
  chain = pending.catch(() => undefined);
  return pending;
};
async function load(): Promise<PalMission[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(path(), "utf8"));
    if (!Array.isArray(raw)) throw Error("Invalid Working Pals database");
    if (raw.length > MAX_MISSIONS || !raw.every(validMission))
      throw Error("Working Pals database needs repair");
    return raw as PalMission[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e; // Never overwrite unknown or corrupted data.
  }
}
async function save(rows: PalMission[]): Promise<void> {
  await mkdir(dir(), { recursive: true, mode: 0o700 });
  const tmp = path() + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, JSON.stringify(rows, null, 2), { mode: 0o600, flag: "wx" });
    await rename(tmp, path());
  } finally {
    const fs = await import("node:fs/promises");
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
async function transaction<T>(change: (rows: PalMission[]) => Promise<T> | T): Promise<T> {
  if (!dir()) throw Error("Working Pals requires the persistent Unraid data volume");
  return serialize(async () => {
    const rows = await load();
    const value = await change(rows);
    await save(rows);
    return value;
  });
}
/** List is also the only restart recovery point: explicit review required before retry. */
export async function listMissions(): Promise<PalMission[]> {
  return transaction((rows) => {
    for (let i = 0; i < rows.length; i++) {
      const mission = rows[i]!;
      if (
        mission.status === "running" &&
        !launching.has(mission.id) &&
        !jobs().state("working:" + mission.id)?.running
      )
        rows[i] = recoverMission(mission);
    }
    return structuredClone(rows);
  });
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message.slice(0, 180) : "Couldn't complete this request";
}
function modify(
  rows: PalMission[],
  id: string,
  expected: number,
  action: "approve" | "revoke" | "pause",
): PalMission | null {
  const m = rows.find((row) => row.id === id);
  if (!m || m.revision !== expected) return null;
  if (action === "approve" && m.status !== "proposed") return null;
  if (action === "pause" && m.status === "revoked") return null;
  if (action === "revoke" && m.status === "revoked") return null;
  m.status = action === "approve" ? "approved" : action === "revoke" ? "revoked" : "paused";
  m.updated = new Date().toISOString();
  m.revision++;
  if (action === "approve") m.approvedAt = m.updated;
  if (action === "revoke" || action === "pause") {
    if (m.schedule) m.schedule.enabled = false;
    jobs().cancel("working:" + id);
  }
  return structuredClone(m);
}
async function execute(id: string, expected: number): Promise<{ ok: boolean; message: string }> {
  const start = await transaction((rows) => {
    const m = rows.find((x) => x.id === id);
    if (!m || m.revision !== expected || !canRun(m) || (m.receipts?.length ?? 0) >= 100)
      return false;
    // Preserve every prior result before another run. Never silently prune history.
    if (m.finishedAt)
      (m.receipts ??= []).push({
        revision: m.revision,
        at: m.finishedAt,
        status: m.status,
        result: m.result,
        error: m.error,
      });
    launching.add(id);
    if (m.schedule?.enabled) m.schedule.next = Date.now() + m.schedule.minutes * 60000;
    m.status = "running";
    m.startedAt = new Date().toISOString();
    m.updated = m.startedAt;
    m.finishedAt = "";
    m.error = "";
    m.revision++;
    return true;
  }).catch((error) => {
    launching.delete(id);
    throw error;
  });
  if (!start)
    return { ok: false, message: "This job changed or needs your approval. Refresh to review it." };
  try {
    const runResult = await jobs().run(
      "working:" + id,
      async (signal) => {
        const current = (await listMissions()).find((m) => m.id === id);
        if (!current || current.status !== "running") return;
        const { keeperRuntime } = await import("./memory-keeper.server");
        if (keeperRuntime().active > 0) throw Error("Foreground conversation has priority");
        const response = await askPals(current.question, {
          localOnly: true,
          signal,
          authority: { kind: "approved-working-pal", missionId: id, revision: expected + 1 },
          maxTokens: 900,
          system:
            "You are a Working Pal performing a specifically approved, READ-ONLY local summary. No browsing, tools, file writes, calendar changes, messaging, external actions, hidden work or claims that actions were done. Answer with a practical summary. Cite only sources actually supplied; say when you lack information. Keep it under 350 words.",
        });
        if (signal.aborted) throw Error("Paused for interactive work");
        await transaction((rows) => {
          const m = rows.find((x) => x.id === id);
          if (!m || m.status !== "running" || m.revision !== expected + 1 || signal.aborted) return;
          m.finishedAt = new Date().toISOString();
          m.updated = m.finishedAt;
          m.revision++;
          if (!response.ok) {
            if (m.schedule) m.schedule.enabled = false;
            m.status = "failed";
            m.error = scrubChatText(response.error).slice(0, 300);
          } else {
            m.status = "completed";
            m.result = scrubChatText(response.text).slice(0, 4000);
            m.error = "";
          }
        });
      },
      { timeoutMs: 180_000, lane: "inference", laneLimit: 1, retries: 0 },
    );
    if (runResult !== "done") {
      await transaction((rows) => {
        const m = rows.find((x) => x.id === id);
        if (!m || m.status !== "running" || m.revision !== expected + 1) return; // Never overwrite a later run.
        m.finishedAt = new Date().toISOString();
        m.updated = m.finishedAt;
        m.status = runResult === "cancelled" ? "paused" : "failed";
        m.error =
          runResult === "timeout"
            ? "Local AI timed out. You can retry."
            : "Job stopped before completion.";
        if (m.schedule) m.schedule.enabled = false;
        m.revision++;
      });
    }
  } finally {
    launching.delete(id);
  }
  const final = (await listMissions()).find((m) => m.id === id);
  return {
    ok: final?.status === "completed",
    message:
      final?.status === "completed"
        ? "Job finished. Review the recorded result."
        : final?.status === "failed"
          ? final.error || "Local AI couldn't finish."
          : "Job stopped or permission changed; its state was saved.",
  };
}
/** Owner-only, explicitly approved, read-only Working Pals inbox. */
export async function handleWorkingPals(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner)
    return Response.json({ error: "Only the owner can manage Working Pals." }, { status: 403 });
  if (!dir())
    return Response.json({ error: "Working Pals requires BUDDY_DATA_DIR." }, { status: 503 });
  try {
    if (request.method === "GET")
      return Response.json(
        { missions: await listMissions() },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const op = body["op"];
    if (op === "propose") {
      const mission = newMission(
        {
          ...body,
          title: scrubChatText(String(body["title"] ?? "")),
          question: scrubChatText(String(body["question"] ?? "")),
        },
        randomUUID(),
        new Date().toISOString(),
      );
      if (!mission)
        return Response.json(
          { error: "Add a title, a short read-only question and a valid scope/project." },
          { status: 400 },
        );
      const created = await transaction((rows) => {
        if (rows.length >= MAX_MISSIONS) return false;
        rows.unshift(mission);
        return true;
      });
      return created
        ? Response.json({ mission, status: "proposed" })
        : Response.json(
            { error: "Inbox full. Resolve or remove older jobs first." },
            { status: 409 },
          );
    }
    if (op === "pause-all") {
      await transaction((rows) => {
        for (const m of rows) {
          if (m.status === "revoked") continue;
          if (m.schedule) m.schedule.enabled = false;
          jobs().cancel("working:" + m.id);
          if (m.status !== "proposed") m.status = "paused";
          m.revision++;
          m.updated = new Date().toISOString();
        }
      });
      return Response.json({ ok: true });
    }
    if (!["schedule", "approve", "revoke", "pause", "run", "remove"].includes(String(op)))
      return Response.json({ error: "Unknown operation." }, { status: 400 });
    const id = typeof body["id"] === "string" ? body["id"] : "";
    const revision = body["revision"];
    if (!/^[0-9a-f-]{36}$/i.test(id) || typeof revision !== "number" || !Number.isInteger(revision))
      return Response.json({ error: "Invalid job or revision." }, { status: 400 });
    if (op === "schedule") {
      const minutes = Number(body["minutes"]);
      if (body["confirm"] !== true || !Number.isInteger(minutes) || minutes < 60 || minutes > 10080)
        return Response.json(
          { error: "Explicitly approve an interval from 60 to 10080 minutes." },
          { status: 400 },
        );
      const saved = await transaction((rows) => {
        const m = rows.find((x) => x.id === id && x.revision === revision);
        if (!m || !canRun(m) || (m.receipts?.length ?? 0) >= 100) return false;
        if (m.status === "paused" || m.status === "interrupted") m.status = "approved";
        m.schedule = {
          minutes,
          next: Date.now() + minutes * 60000,
          enabled: true,
          approvedAt: new Date().toISOString(),
        };
        m.revision++;
        return true;
      });
      return Response.json(
        saved ? { ok: true } : { error: "Refresh and approve the job before scheduling." },
        { status: saved ? 200 : 409 },
      );
    }
    if (op === "remove") {
      if (body["confirm"] !== true)
        return Response.json(
          { error: "Deleting a job requires explicit confirmation." },
          { status: 400 },
        );
      const removed = await transaction((rows) => {
        const index = rows.findIndex(
          (x) => x.id === id && x.revision === revision && x.status !== "running",
        );
        if (index < 0) return false;
        rows.splice(index, 1);
        return true;
      });
      return removed
        ? Response.json({ ok: true })
        : Response.json(
            { error: "Job changed or is running. Pause it and refresh before deleting." },
            { status: 409 },
          );
    }
    if (op === "run") {
      const result = await execute(id, revision);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }
    const result = await transaction((rows) =>
      modify(rows, id, revision, op as "approve" | "revoke" | "pause"),
    );
    return result
      ? Response.json({ mission: result })
      : Response.json(
          { error: "Job changed or that action is not allowed. Refresh before retrying." },
          { status: 409 },
        );
  } catch (e) {
    return Response.json(
      { error: "Working Pals couldn't save this change: " + errorText(e) },
      { status: 500 },
    );
  }
}

/** Only previously approved immutable questions recur. No catch-up burst or automatic retries. */
export async function tickWorkingPals(now = Date.now()): Promise<void> {
  if (!dir()) return;
  const { keeperRuntime } = await import("./memory-keeper.server");
  if (keeperRuntime().active > 0) return;
  const rows = await listMissions();
  if (rows.some((m) => m.status === "running")) return;
  const due = rows.find(
    (m) =>
      m.schedule?.enabled &&
      m.schedule.next <= now &&
      canRun(m) &&
      m.status !== "paused" &&
      m.status !== "interrupted",
  );
  if (due) await execute(due.id, due.revision);
}
