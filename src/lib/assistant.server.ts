import { responseLines, answerPreview } from "./assistant-stream";
import { readCaptures } from "./capture.server";
import { webMode, needsWeb, clockContext, type WebReceipt } from "./assistant-web";
import { scrubChatData, scrubChatText } from "./chat-scrub";
import { randomUUID } from "node:crypto";
import { currentUser, ownerName } from "./accounts.server";
import { ownerEngineJson } from "./ask.server";
import { accountsEnabled } from "./accounts";
import { chatTransaction, readChatRows, type Row } from "./store.server";
import {
  newMeta,
  sensitive,
  safeId,
  authorized,
  normalize,
  words,
  retrieve,
  contextMessages,
  messageString,
  type Conversation,
  type Memory,
  type Scope,
} from "./assistant";
import {
  activity,
  createMemory,
  fingerprint,
  invalidate,
  keeperRoot,
  keeperSnapshot,
  keeperTransaction,
  syncKeeper,
  validMemory,
  versionKeep,
  recoverKeeperMarkdown,
} from "./keeper-store.server";
import {
  enqueueKeeper,
  foregroundStart,
  foregroundEnd,
  keeperRuntime,
  numberSetting,
  scheduleKeeper,
  semanticScores,
} from "./memory-keeper.server";
import { handleChat } from "./chat.server";
import { engineFromJson, localServerProvider, turnProviders, type TurnProvider } from "./engine";
import { readOllamaHealth } from "./ollama-health.server";
import { installedName } from "./ollama-health";
import { isModelName } from "./model-catalog";
import { localOnlyOn } from "./ai/guard.server";
import { handleSearch } from "./search.server";
import { handleToday } from "./today.server";
import { handleSecondBrain } from "./second-brain.server";
import { models, type RoomMessage } from "./agents";
const reply = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const running = new Set<string>();
type DiscordInternal = { ownerName: string };
let discordBusy = false;
const mine = (rows: Row[], owner: string) =>
  rows.filter((r) => r.assistant && r.owner === owner && !r.shared) as Conversation[];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
async function lookupWeb(question: string, data: Record<string, unknown>, req: Request) {
  let search: unknown = null;
  const requestedWeb = webMode(data["web"], data["research"]);
  const web: WebReceipt = {
    state: requestedWeb === "off" ? "off" : "not-needed",
    at: new Date().toISOString(),
    cached: false,
    hits: [],
  };
  if (needsWeb(question, requestedWeb)) {
    const r = await handleSearch(
      new Request(
        "http://localhost/api/search?" + new URLSearchParams({ q: question.slice(0, 300) }),
        { headers: req.headers, signal: req.signal },
      ),
    ).catch(() => null);
    const result = r?.ok ? await r.json().catch(() => null) : null;
    if (result && Array.isArray(result.hits)) {
      web.hits = result.hits
        .filter(
          (h: { title?: unknown; url?: unknown; snippet?: unknown }) =>
            typeof h.url === "string" && /^https?:\/\//i.test(h.url),
        )
        .slice(0, 6)
        .map((h: { title?: unknown; url: string; snippet?: unknown }) => ({
          title: String(h.title ?? "Source").slice(0, 140),
          url: h.url.slice(0, 500),
          snippet: String(h.snippet ?? "").slice(0, 280),
        }));
      web.cached = result.cached === true;
      web.state = web.hits.length ? "connected" : "no-results";
      search = { query: question, checkedAt: web.at, cached: web.cached, hits: web.hits };
    } else {
      web.state = "unavailable";
      search = {
        unavailable: true,
        note: "Web search is unavailable. Do not claim current verification. Ask the user to configure Web search in Settings → Integrations.",
      };
    }
  }

  return { search, web };
}
async function invalidateSummaries() {
  await chatTransaction(async (rows) => {
    for (const r of rows)
      if (r.assistant) {
        r.assistant.summary = "";
        r.assistant.summaryThrough = 0;
        delete r.assistant.continuation;
        r.assistant.revision++;
      }
    return { rows, value: undefined };
  });
}
async function parseAnswer(
  response: Response,
  signal: AbortSignal,
  preview?: (text: string) => Promise<void>,
  maskIdentifiers = false,
): Promise<string> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (data.code === "ollama-model" || data.code === "local-only")
      throw Error(String(data.error).slice(0, 400));
    throw Error("The selected provider could not answer. Check AI settings or choose Auto.");
  }
  let result = "",
    lastPreview = "",
    lastSent = 0,
    completed = false;
  for await (const line of responseLines(response, signal)) {
    if (line === "data: [DONE]") {
      completed = true;
      continue;
    }
    if (!line.startsWith("data: ")) continue;
    let d;
    try {
      d = JSON.parse(line.slice(6));
    } catch {
      throw Error("The provider sent an invalid response. Your question is saved; retry.");
    }
    if (d.type === "finish") completed = true;
    if (d.type === "error" || d.type === "abort" || d.finishReason === "error")
      throw Error(
        "The provider interrupted this answer. Your question is saved; retry or choose another provider.",
      );
    if (d.type === "text-delta" && typeof d.delta === "string") result += d.delta;
    if (result.length > 50000)
      throw Error("Answer exceeded the size limit. Ask a narrower question.");
    if (preview && Date.now() - lastSent >= 150) {
      const safe = answerPreview(result, { maskIdentifiers });
      if (safe !== lastPreview) {
        await preview(safe);
        lastPreview = safe;
        lastSent = Date.now();
      }
    }
  }
  if (!completed)
    throw Error(
      "The provider disconnected before completing the answer. Your question is saved; retry.",
    );
  if (!result.trim()) throw Error("The provider returned no text. Your question is saved.");
  return result.trim();
}
function streamedAnswer(req: Request, data: Record<string, unknown>): Response {
  const cancelled = new AbortController();
  const signal = AbortSignal.any([req.signal, cancelled.signal, AbortSignal.timeout(180000)]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: { type: string; [key: string]: unknown }) => {
        signal.throwIfAborted();
        if (value.type === "preview" && (controller.desiredSize ?? 0) <= 0) return;
        controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      };
      send({ type: "status", text: "Checking context and available AI…" });
      void (async () => {
        try {
          const response = await handleAssistant(
            new Request(req.url, {
              method: "POST",
              headers: req.headers,
              body: JSON.stringify({ ...data, stream: false }),
              signal,
            }),
            async (text) => send({ type: "preview", text }),
          );
          const result = await response.json();
          send(
            response.ok
              ? { type: "done", result }
              : { type: "error", error: result.error, status: response.status },
          );
        } catch {
          if (!signal.aborted)
            send({
              type: "error",
              error: "The answer was interrupted. Your question is saved; retry when connected.",
            });
        } finally {
          try {
            controller.close();
          } catch {
            /* The browser cancelled the stream. */
          }
        }
      })();
    },
    cancel() {
      cancelled.abort();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
export async function handleAssistant(
  req: Request,
  preview?: (text: string) => Promise<void>,
  internal?: DiscordInternal,
): Promise<Response> {
  if (!keeperRoot())
    return reply(
      {
        error: "General Chat needs persistent self-hosted storage. Existing Pals remain available.",
      },
      404,
    );
  if (!accountsEnabled(process.env))
    return reply(
      { error: "Enable local accounts and sign in as owner to use persistent assistant memory." },
      403,
    );
  const user = internal ? { owner: true, username: internal.ownerName } : await currentUser(req);
  if (!user?.owner) return reply({ error: "Owner sign-in required" }, 403);
  const owner = user.username.toLowerCase();
  scheduleKeeper();
  try {
    const url = new URL(req.url),
      state = await keeperSnapshot(),
      all = mine(await readChatRows(), owner);
    if (req.method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        const c = all.find((x) => x.id === id);
        if (!c) return reply({ error: "Conversation not found" }, 404);
        if (c.assistant.summaryEpoch !== state.epoch) c.assistant.summary = "";
        return reply({ conversation: c });
      }
      if (url.searchParams.get("view") === "memory") {
        const q = normalize(url.searchParams.get("q") ?? "");
        const records = state.records.filter(
          (m) => !q || normalize(m.title + " " + m.text).includes(q),
        );
        const health = await readOllamaHealth().catch(() => null);
        const captureRows = await readCaptures().catch(() => []);
        return reply({
          records: records.slice(0, 200),
          conversations: all.map((c) => ({ id: c.id, title: c.title })),
          total: state.records.length,
          active: state.records.filter((m) => m.status === "active").length,
          pending: state.records.filter((m) => m.status === "pending").length,
          projects: state.projects,
          jobs: state.jobs,
          captureJobs: {
            pending: captureRows.filter(
              (r) => r.inbox?.status === "pending" && r.inbox.job.state !== "done",
            ).length,
            failed: captureRows.filter((r) => r.inbox?.job.state === "failed").length,
          },
          lastSuccess: state.lastSuccess,
          activity: state.activity,
          sync: state.sync,
          epoch: state.epoch,
          bytes: Buffer.byteLength(JSON.stringify(state), "utf8"),
          model: process.env["MEMORY_KEEPER_MODEL"] || "auto",
          online: health?.reachable ?? false,
          enabled: process.env["MEMORY_KEEPER_ENABLED"] !== "off",
          runtime: keeperRuntime(),
          index: {
            vectors: Object.keys(state.vectors).length,
            model: process.env["MEMORY_EMBED_MODEL"] || "keyword fallback",
          },
        });
      }
      return reply({
        conversations: all
          .filter((c) => {
            const q = normalize(url.searchParams.get("q") ?? "");
            return (
              !q || normalize(c.title + " " + c.messages.map(messageString).join(" ")).includes(q)
            );
          })
          .map((c) => ({ ...c, messages: [], messageCount: c.messages.length })),
        projects: state.projects,
        privacy: { maskIdentifiers: process.env["CHAT_MASK_IDENTIFIERS"] === "on" },
        legacy: (await readChatRows())
          .filter((r) => !r.assistant && (!r.owner || r.owner === owner))
          .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt })),
      });
    }
    if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    const raw = await req.text();
    if (raw.length > 8000000) return reply({ error: "Request too large" }, 413);
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return reply({ error: "Invalid request" }, 400);
    const op = data["op"];
    if (op === "ask" && data["stream"] === true && !preview) return streamedAnswer(req, data);
    if (op === "create" || op === "import-legacy" || op === "continue") {
      if (all.length >= 300)
        return reply(
          { error: "Conversation limit reached. Export chats before removing any." },
          413,
        );
      let project = text(data["project"], 80),
        messages: RoomMessage[] = [],
        continuation: Conversation["assistant"]["continuation"],
        privateIds: string[] = [];
      if (project && !state.projects.some((p) => p.id === project))
        return reply({ error: "Choose an existing project" }, 400);
      if (op === "continue") {
        const source = all.find((c) => c.id === data["id"] && c.assistant.status !== "deleted");
        if (!source) return reply({ error: "Source conversation unavailable" }, 404);
        if (
          (source.assistant.project || source.assistant.privateIds.length) &&
          data["confirmScope"] !== true
        )
          return reply(
            { error: "Approve carrying project/private access into the new conversation" },
            409,
          );
        project = source.assistant.project;
        privateIds = [...source.assistant.privateIds];
        const context =
          source.assistant.summaryEpoch === state.epoch && source.assistant.summary
            ? source.assistant.summary
            : source.messages
                .filter(
                  (m) =>
                    m.role === "user" &&
                    !sensitive(messageString(m)) &&
                    !state.suppressed.includes(source.id + ":" + m.id),
                )
                .slice(-2)
                .map((m) => messageString(m).slice(0, 1200))
                .join("\n");
        continuation = { id: source.id, epoch: state.epoch, text: context.slice(0, 4000) };
      }
      if (op === "import-legacy") {
        const source = (await readChatRows()).find(
          (c) => c.id === data["id"] && !c.assistant && (!c.owner || c.owner === owner),
        );
        if (!source) return reply({ error: "Legacy chat unavailable" }, 404);
        messages = (source.messages as RoomMessage[])
          .filter((m) => ["user", "assistant"].includes(m.role) && Array.isArray(m.parts))
          .map((m) => ({
            id: randomUUID(),
            role: m.role,
            parts: [
              {
                type: "text",
                text: sensitive(messageString(m))
                  ? "[Credential-containing message withheld]"
                  : messageString(m).slice(0, 30000),
              },
            ],
            ...(m.role === "assistant" ? { metadata: { agentId: "echo" as const } } : {}),
          }));
      }
      const c: Conversation = {
        id: randomUUID(),
        title: text(data["title"], 100) || "General Chat",
        messages,
        mode: internal ? "discord" : "direct",
        theme: "normal",
        updatedAt: new Date().toISOString(),
        owner,
        shared: false,
        assistant: { ...newMeta(), project, privateIds, ...(continuation ? { continuation } : {}) },
      };
      await chatTransaction(async (rows) => ({ rows: [c, ...rows], value: undefined }));
      return reply({ conversation: c });
    }
    if (op === "scrub-history") {
      await chatTransaction(async (rows) => {
        for (const row of rows) {
          if (row.owner && row.owner !== owner) continue;
          row.title = scrubChatText(row.title);
          row.messages = scrubChatData(row.messages);
          if (row.assistant) {
            row.assistant.draft = scrubChatText(row.assistant.draft);
            row.assistant.summary = "";
            delete row.assistant.continuation;
            row.assistant.revision++;
          }
        }
        return { rows, value: undefined };
      });
      await keeperTransaction((s) => {
        s.epoch++;
        s.vectors = {};
        s.jobs = [];
        for (const m of s.records) {
          const cleaned = scrubChatText(m.text);
          if (cleaned !== m.text) {
            invalidate(s, m);
            m.text = cleaned;
            m.status = "pending";
            m.verified = false;
            m.revision++;
          }
          m.title = scrubChatText(m.title);
          m.sources = m.sources.map((src) => ({ ...src, quote: scrubChatText(src.quote) }));
          m.versions = m.versions.map((v) => ({ ...v, text: scrubChatText(v.text) }));
        }
        activity(s, "Recognizable credentials scrubbed from live chat and memory stores");
      });
      return reply({
        ok: true,
        note: "Live chat and memory stores scrubbed. Backups, exports, images and manually edited vault copies need separate review.",
      });
    }
    if (op === "project") {
      const name = text(data["name"], 80);
      if (!name || sensitive(name))
        return reply({ error: "Give the project a non-sensitive name" }, 400);
      const project = await keeperTransaction((s) => {
        const same = s.projects.find((p) => normalize(p.name) === normalize(name));
        if (same) return same;
        if (s.projects.length >= 100) throw Error("Project limit reached");
        const p = { id: randomUUID(), name };
        s.projects.push(p);
        return p;
      });
      return reply({ project });
    }
    if (op === "memory-save" || op === "memory-action") {
      const result = await keeperTransaction((s) => {
        const id = data["id"],
          m = s.records.find((x) => x.id === id);
        if (m && data["revision"] !== m.revision)
          throw Error("Memory changed. Refresh before saving.");
        if (op === "memory-save") {
          const title = text(data["title"], 120),
            body = text(data["text"], 2400),
            scope = data["scope"] as Scope,
            project = text(data["project"], 80),
            conversation = text(data["conversation"], 80);
          if (
            !title ||
            !body ||
            sensitive(title + " " + body) ||
            !["global", "project", "conversation", "private"].includes(scope) ||
            (scope === "project" && !s.projects.some((p) => p.id === project)) ||
            (scope === "conversation" && !all.some((c) => c.id === conversation))
          )
            throw Error(
              "Enter valid memory text and an authorized scope. Credentials are refused.",
            );
          if (m) {
            if (
              (m.scope !== scope || m.project !== project || m.conversation !== conversation) &&
              data["confirmScope"] !== true
            )
              throw Error("Approve the scope change first");
            m.versions.unshift({
              text: m.text,
              at: m.updated,
              scope: m.scope,
              project: m.project,
              conversation: m.conversation,
            });
            m.versions = m.versions.slice(0, versionKeep());
            invalidate(s, m);
            Object.assign(m, {
              title,
              text: body,
              scope,
              project: scope === "project" ? project : "",
              conversation: scope === "conversation" ? conversation : "",
              status: "active",
              verified: true,
              confidence: 1,
              revision: m.revision + 1,
              updated: new Date().toISOString(),
            });
            activity(s, "Explicit memory correction saved");
            return m;
          }
          return createMemory(s, {
            title,
            text: body,
            scope,
            project: scope === "project" ? project : "",
            conversation: scope === "conversation" ? conversation : "",
            verified: true,
          });
        }
        if (!m) throw Error("Memory not found");
        const action = data["action"];
        if (action === "delete") {
          invalidate(s, m);
          s.forgotten.push(fingerprint(m.text));
          m.text = "";
          m.title = "Deleted memory";
          m.versions = [];
          m.sources = [];
          m.status = "deleted";
        } else if (action === "archive") {
          invalidate(s, m);
          m.status = "archived";
        } else if (action === "restore") {
          if (m.status === "deleted")
            throw Error("Purged memory cannot be restored without explicit re-entry");
          m.status = "pending";
        } else if (action === "approve") {
          if (m.conflicts.length && data["confirmReplace"] !== true)
            throw Error("Review conflicting records before approval");
          for (const old of s.records.filter((x) => m.conflicts.includes(x.id))) {
            invalidate(s, old);
            old.status = "archived";
          }
          m.status = "active";
          m.verified = true;
          m.confidence = 1;
        } else if (action === "pin") m.pinned = !m.pinned;
        else if (action === "version") {
          const v = m.versions[Number(data["version"])];
          if (!v) throw Error("Version unavailable");
          if (v.scope !== m.scope || v.project !== m.project || v.conversation !== m.conversation)
            throw Error("Copy this version into the editor and explicitly approve its scope");
          invalidate(s, m);
          m.versions.unshift({
            text: m.text,
            at: m.updated,
            scope: m.scope,
            project: m.project,
            conversation: m.conversation,
          });
          m.text = v.text;
          m.versions = m.versions.slice(0, versionKeep());
          m.status = "active";
          m.verified = true;
        } else throw Error("Unknown memory action");
        m.updated = new Date().toISOString();
        m.revision++;
        activity(s, "Memory " + String(action));
        return m;
      });
      if (data["action"] !== "pin") await invalidateSummaries();
      return reply({ memory: result });
    }
    if (op === "sync") return reply(await syncKeeper(data["importEdits"] === true));
    if (op === "recover-markdown") {
      if (data["confirm"] !== true)
        return reply({ error: "Confirm private recovery of managed Markdown" }, 400);
      return reply({ added: await recoverKeeperMarkdown() });
    }
    if (op === "rebuild") {
      await keeperTransaction((s) => {
        s.vectors = {};
        activity(
          s,
          "Retrieval index cleared; keywords remain available and vectors rebuild on demand",
        );
      });
      return reply({ ok: true });
    }
    if (op === "retry") {
      await keeperTransaction((s) => {
        s.jobs.forEach((j) => {
          j.state = "pending";
          j.attempts = 0;
          j.next = 0;
        });
      });
      scheduleKeeper(1);
      return reply({ ok: true });
    }
    if (op === "import-brain") {
      const r = await handleSecondBrain(new Request(req.url, { headers: req.headers }));
      if (!r.ok) return reply({ error: "Existing Second Brain vault is unavailable" }, 409);
      const body = (await r.json()) as { notes: { id: string; title: string; body: string }[] };
      const added = await keeperTransaction((s) => {
        let count = 0;
        for (const n of body.notes) {
          if (sensitive(n.body)) continue;
          if (
            createMemory(s, {
              title: n.title,
              text: n.body,
              scope: "private",
              verified: false,
              pending: true,
              key: n.id,
            })
          )
            count++;
        }
        return count;
      });
      return reply({ added });
    }
    if (op === "export")
      return reply({
        format: "pixel-pals-keeper-v1",
        records: state.records,
        projects: state.projects,
        conversations: all,
        forgotten: state.forgotten,
        suppressed: state.suppressed,
        epoch: state.epoch,
      });
    if (op === "restore") {
      const archive = data["archive"] as {
        conversations?: Conversation[];
        format?: string;
        records?: Memory[];
        projects?: { id: string; name: string }[];
      };
      if (
        data["confirm"] !== true ||
        archive?.format !== "pixel-pals-keeper-v1" ||
        !Array.isArray(archive.records) ||
        archive.records.length > 2000 ||
        !archive.records.every(validMemory) ||
        archive.records.some((m) => sensitive(m.text)) ||
        !Array.isArray(archive.projects) ||
        archive.projects.length > 100 ||
        !archive.projects.every(
          (p) => safeId(p.id) && typeof p.name === "string" && p.name.length <= 80,
        )
      )
        return reply({ error: "Invalid memory export or missing restore confirmation" }, 400);
      await keeperTransaction((s) => {
        for (const p of archive.projects!) {
          if (!s.projects.some((x) => x.id === p.id)) s.projects.push(p);
        }
        for (const m of archive.records!) {
          if (s.forgotten.includes(fingerprint(m.text)) || s.records.some((x) => x.id === m.id))
            continue;
          s.records.push({
            ...m,
            status: m.status === "deleted" ? "deleted" : "pending",
            verified: false,
            versions: [],
            sources: [],
          });
        }
        s.epoch++;
        activity(s, "Memory export merged for review; deleted records were not resurrected");
      });
      if (Array.isArray(archive.conversations))
        await chatTransaction(async (rows) => {
          let count = mine(rows, owner).length;
          for (const original of archive.conversations!.slice(0, 300)) {
            if (count >= 300) break;
            if (
              !original ||
              !safeId(original.id) ||
              original.id.length < 8 ||
              rows.some((r) => r.id === original.id) ||
              typeof original.title !== "string" ||
              !Array.isArray(original.messages) ||
              original.messages.length > 5000 ||
              JSON.stringify(original).length > 1900000
            )
              continue;
            const messages: RoomMessage[] = original.messages
              .filter(
                (m) =>
                  m &&
                  typeof m.id === "string" &&
                  ["user", "assistant"].includes(m.role) &&
                  Array.isArray(m.parts),
              )
              .map((m) => ({
                id: m.id,
                role: m.role,
                parts: [
                  {
                    type: "text",
                    text: sensitive(messageString(m))
                      ? "[Credential-containing message withheld]"
                      : messageString(m).slice(0, 50000),
                  },
                ],
                ...(m.role === "assistant" ? { metadata: { agentId: "echo" as const } } : {}),
              }));
            rows.push({
              id: original.id,
              title: original.title.slice(0, 100),
              messages,
              mode: "direct",
              theme: "normal",
              owner,
              shared: false,
              updatedAt: new Date().toISOString(),
              assistant: {
                ...newMeta(),
                status: "archived",
                collect: "off",
                project: [...state.projects, ...archive.projects!].some(
                  (p) => p.id === original.assistant?.project,
                )
                  ? original.assistant.project
                  : "",
              },
            });
            count++;
          }
          return { rows, value: undefined };
        });
      await invalidateSummaries();
      return reply({ ok: true });
    }
    const c = all.find((x) => x.id === data["id"]);
    if (!c) return reply({ error: "Conversation not found" }, 404);
    if (op === "inspect") {
      const message = c.messages.find((m) => m.id === data["messageId"]);
      return reply({
        memories: state.records
          .filter((m) => message?.metadata?.memoryIds?.includes(m.id) && authorized(m, c))
          .map((m) => ({
            id: m.id,
            title: m.title,
            text: m.text,
            scope: m.scope,
            verified: m.verified,
          })),
      });
    }
    if (op === "update") {
      if (running.has(c.id))
        return reply(
          { error: "Stop or finish the active answer before changing its permissions." },
          409,
        );
      if (data["revision"] !== c.assistant.revision)
        return reply(
          { error: "This conversation changed in another tab. Refresh; your draft is retained." },
          409,
        );
      const patch = data["patch"] as Record<string, unknown>;
      if (!patch || typeof patch !== "object") return reply({ error: "Invalid patch" }, 400);
      if (patch["project"] !== undefined && patch["project"] !== c.assistant.project) {
        if (data["confirmScope"] !== true)
          return reply({ error: "Approve moving this conversation to another project" }, 409);
        const project = text(patch["project"], 80);
        if (project && !state.projects.some((p) => p.id === project))
          return reply({ error: "Unknown project" }, 400);
        c.assistant.project = project;
        c.assistant.summary = "";
        delete c.assistant.continuation;
        await keeperTransaction((s) => {
          s.epoch++;
          s.jobs = s.jobs.filter((j) => j.conversation !== c.id);
        });
      }
      if (patch["privateIds"] !== undefined) {
        if (
          data["confirmScope"] !== true ||
          !Array.isArray(patch["privateIds"]) ||
          patch["privateIds"].length > 30 ||
          !patch["privateIds"].every((id) =>
            state.records.some(
              (m) => m.id === id && m.scope === "private" && m.status === "active",
            ),
          )
        )
          return reply({ error: "Approve valid private memory access explicitly" }, 400);
        c.assistant.privateIds = patch["privateIds"] as string[];
        c.assistant.summary = "";
        delete c.assistant.continuation;
        await keeperTransaction((s) => {
          s.epoch++;
        });
      }
      const choice = patch["choice"] as
        { provider?: unknown; model?: unknown; research?: unknown; web?: unknown } | undefined;
      if (
        choice &&
        typeof choice.provider === "string" &&
        typeof choice.model === "string" &&
        choice.model.length <= 120 &&
        typeof choice.research === "boolean"
      )
        c.assistant.choice = {
          provider: choice.provider,
          model: choice.model,
          research: choice.research,
          web: webMode(choice.web, choice.research),
        };
      if (typeof patch["title"] === "string") c.title = text(patch["title"], 100) || c.title;
      if (typeof patch["draft"] === "string" && patch["draft"].length <= 10000)
        c.assistant.draft = scrubChatText(patch["draft"]);
      if (typeof patch["pinned"] === "boolean") c.assistant.pinned = patch["pinned"];
      if (["active", "archived", "deleted"].includes(String(patch["status"]))) {
        c.assistant.status = patch["status"] as "active" | "archived" | "deleted";
        if (c.assistant.status === "deleted") {
          c.assistant.deletedAt = new Date().toISOString();
          await keeperTransaction((s) => {
            s.jobs = s.jobs.filter((j) => j.conversation !== c.id);
          });
        }
      }
      if (["off", "review", "auto"].includes(String(patch["collect"]))) {
        c.assistant.collect = patch["collect"] as "off" | "review" | "auto";
        if (c.assistant.collect === "off")
          await keeperTransaction((s) => {
            s.epoch++;
            s.jobs = s.jobs.filter((j) => j.conversation !== c.id);
          });
      }
      c.assistant.revision++;
      c.updatedAt = new Date().toISOString();
      await chatTransaction(async (rows) => ({
        rows: rows.map((r) => (r.id === c.id ? c : r)),
        value: undefined,
      }));
      return reply({ conversation: c });
    }
    if (op === "checkpoint") {
      if (c.assistant.collect === "off")
        return reply({ error: "Enable Review or Auto collection for a local AI checkpoint." }, 409);
      if (running.has(c.id))
        return reply({ error: "Wait for the active answer before rebuilding a checkpoint" }, 409);
      // Rebuild from durable messages, including after a correction invalidated an old summary.
      c.assistant.processed = 0;
      c.assistant.summary = "";
      c.assistant.summaryThrough = 0;
      c.assistant.revision++;
      await chatTransaction(async (rows) => ({
        rows: rows.map((r) => (r.id === c.id ? c : r)),
        value: undefined,
      }));
      await keeperTransaction((s) => {
        s.jobs = s.jobs.filter((j) => j.conversation !== c.id);
      });
      await enqueueKeeper(c);
      return reply({ ok: true, conversation: c });
    }
    if (op !== "ask") return reply({ error: "Unknown operation" }, 400);
    if (c.assistant.status !== "active")
      return reply({ error: "Restore or unarchive this conversation before continuing" }, 409);
    if (data["revision"] !== c.assistant.revision || running.has(c.id))
      return reply(
        {
          error:
            "This conversation is busy or changed. Refresh before sending; your draft is kept.",
        },
        409,
      );
    const rawQuestion = text(data["question"], 10000);
    const question = scrubChatText(rawQuestion, {
      maskIdentifiers:
        process.env["CHAT_MASK_IDENTIFIERS"] === "on" || data["maskIdentifiers"] === true,
    });
    if (!question)
      return reply(
        {
          error: "Type a question to continue.",
        },
        400,
      );
    running.add(c.id);
    await foregroundStart();
    try {
      const latest = (await readChatRows()).find((row) => row.id === c.id);
      if (latest?.assistant?.revision !== c.assistant.revision)
        return reply(
          {
            error:
              "Conversation changed while memory processing paused. Refresh; your draft is kept.",
          },
          409,
        );
      if (!c.messages.length && c.title === "General Chat")
        c.title = question.replace(/\s+/g, " ").slice(0, 70);
      const last = c.messages.at(-1);
      if (last?.role !== "user" || messageString(last) !== question)
        c.messages.push({
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: question }],
        });
      if (JSON.stringify(c).length > 1900000 || c.messages.length > 5000)
        return reply(
          { error: "This conversation is full. Export it or continue in a fresh chat." },
          413,
        );
      c.assistant.choice = {
        provider: text(data["provider"], 40) || "auto",
        model: text(data["model"], 120),
        research: data["research"] === true,
        web: webMode(data["web"], data["research"]),
      };
      c.assistant.draft = question;
      c.assistant.revision++;
      await chatTransaction(async (rows) => ({
        rows: rows.map((r) => (r.id === c.id ? c : r)),
        value: undefined,
      }));
      const fresh = await keeperSnapshot();
      const [semantic, health, webResult] = await Promise.all([
        semanticScores(question, c, fresh.records),
        readOllamaHealth(req.signal),
        lookupWeb(question, data, req),
      ]);
      const web = webResult.web;
      const memories = internal && process.env["DISCORD_MEMORY_ACCESS"] !== "on" ? [] : retrieve(
        question, c, fresh, numberSetting("MEMORY_CONTEXT_CHARS", 2400, 400, 6000), semantic,
      );
      const budget = numberSetting("ASSISTANT_CONTEXT_CHARS", 16000, 4000, 48000);
      // Discord defaults to no memory sharing. Withholding freshly retrieved
      // records is insufficient if past replies carried retrieved memory.
      const discordMemoryOff = !!internal && process.env["DISCORD_MEMORY_ACCESS"] !== "on";
      const messages = contextMessages(c, fresh, budget).filter(
        (m) => !discordMemoryOff || !m.metadata?.memoryIds?.length,
      );
      const search = webResult.search;
      let tool: unknown = null;
      if (!internal && /\b(my tasks|my to.?dos|plan my day)\b/i.test(question)) {
        const r = await handleToday(
          new Request("http://localhost/api/today", { headers: req.headers }),
        );
        tool = r.ok ? JSON.stringify(await r.json()).slice(0, 4000) : "Tasks unavailable";
      }
      const settings = engineFromJson(JSON.stringify(data["engine"] ?? {}));
      const mode = typeof data["provider"] === "string" ? data["provider"] : "auto";
      const override = text(data["model"], 120);
      if (mode === "ollama-server" && !health.reachable)
        return reply(
          {
            error:
              "Ollama is offline. Your question is saved; reconnect the remote host and retry.",
          },
          503,
        );
      if (
        mode === "ollama-server" &&
        override &&
        !installedName(
          override,
          health.models.map((m) => m.name),
        )
      )
        return reply(
          {
            error:
              "Requested model is not installed. Choose an installed replacement in conversation controls: " +
              health.models
                .slice(0, 8)
                .map((m) => m.name)
                .join(", "),
          },
          409,
        );
      let local = localServerProvider(settings, { text: question });
      if (override && mode === "ollama-server") {
        if (!isModelName(override))
          return reply({ error: "Choose a valid installed Ollama model" }, 400);
        local = { ...local, model: override };
      }
      if (
        mode === "auto" &&
        c.assistant.provider?.kind === "ollama-server" &&
        installedName(
          c.assistant.provider.model,
          health.models.map((m) => m.name),
        )
      )
        local = { ...local, model: c.assistant.provider.model };
      const clouds = localOnlyOn() ? [] : turnProviders(settings, mode === "auto");
      let providers: TurnProvider[] =
        mode === "auto"
          ? [...(health.reachable ? [local] : []), ...clouds]
          : mode === "ollama-server"
            ? [local]
            : clouds.filter((p) => p.kind === mode);
      if (mode === "auto" && c.assistant.provider?.kind !== "ollama-server") {
        const i = providers.findIndex((p) => p.kind === c.assistant.provider?.kind);
        if (i > 0) providers = [providers[i]!, ...providers.filter((_, j) => j !== i)];
      }
      if (!providers.length)
        return reply(
          {
            error: localOnlyOn()
              ? "Local-Only is enabled. Connect Ollama and choose an installed model."
              : "No configured provider is available. Connect Ollama or add a provider key in AI engine settings.",
          },
          503,
        );
      let answer = "",
        provider: TurnProvider | undefined,
        actualModel = "",
        lastError = "";
      let supplied: Memory[] = [];
      for (const p of providers) {
        if (req.signal.aborted) throw Error("Cancelled");
        try {
          await preview?.("");
          const allowMemory =
            p.kind === "ollama-server" || process.env["MEMORY_CLOUD_CONTEXT"] === "on";
          supplied = allowMemory ? memories : [];
          if ((await keeperSnapshot()).epoch !== fresh.epoch)
            throw Error("Memory permissions changed; retry with fresh context");
          const providerMessages = allowMemory
            ? messages
            : messages.filter((m) => !m.metadata?.memoryIds?.length);
          const summary =
            allowMemory && !discordMemoryOff && c.assistant.summaryEpoch === fresh.epoch ? c.assistant.summary : "";
          const restored =
            allowMemory && c.assistant.continuation?.epoch === fresh.epoch
              ? c.assistant.continuation.text
              : "";
          const context = JSON.stringify({
            memories: supplied.map((m) => ({
              id: m.id,
              text: m.text,
              verified: m.verified,
              category: m.category ?? "fact",
              scope: m.scope,
            })),
            checkpoint: summary,
            continuedContext: restored,
            search,
            currentTime: clockContext(data["timeZone"] ?? process.env["BUDDY_TZ"]),
            readOnlyTasks: tool,
            omittedMessages: c.messages.length - messages.length,
            notice:
              "Older transcript is preserved in storage. If the checkpoint does not cover something, ask rather than invent prior instructions.",
          });
          const r = await handleChat(
            new Request(req.url, {
              method: "POST",
              headers: req.headers,
              body: JSON.stringify({
                agentId: "echo",
                model: models[0]!.id,
                mode: "direct",
                round: 1,
                messages: providerMessages,
                engine: p,
                contextBudget: Math.ceil(budget / 4),
              }),
              signal: req.signal,
            }),
            context,
            internal !== undefined,
          );
          answer = scrubChatText(
            await parseAnswer(
              r,
              req.signal,
              preview
                ? async (text) => {
                    if ((await keeperSnapshot()).epoch !== fresh.epoch)
                      throw Error(
                        "Memory permissions changed during this answer. Retry with fresh context.",
                      );
                    await preview(text);
                  }
                : undefined,
              process.env["CHAT_MASK_IDENTIFIERS"] === "on" || data["maskIdentifiers"] === true,
            ),
            {
              maskIdentifiers:
                process.env["CHAT_MASK_IDENTIFIERS"] === "on" || data["maskIdentifiers"] === true,
            },
          );
          provider = p;
          actualModel = r.headers.get("x-pixelpals-model") ?? p.model ?? p.kind;
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : "Provider unavailable";
          if (mode !== "auto") break;
        }
      }
      if (!provider || !answer)
        return reply(
          { error: lastError || "No provider could answer. Your question is saved." },
          503,
        );
      req.signal.throwIfAborted();
      // Recheck privacy epoch before saving the receipt; a concurrent correction invalidates this turn.
      if ((await keeperSnapshot()).epoch !== fresh.epoch)
        return reply(
          { error: "Memory permissions changed during this answer. Retry with fresh context." },
          409,
        );
      c.messages.push({
        id: randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: answer }],
        metadata: {
          agentId: "echo",
          model: actualModel,
          via: provider.kind,
          memoryIds: supplied.map((m) => m.id),
          memoryEpoch: fresh.epoch,
          web,
        },
      });
      c.assistant.provider = { kind: provider.kind, model: actualModel };
      c.assistant.draft = "";
      c.assistant.revision++;
      c.updatedAt = new Date().toISOString();
      const suggestion = fresh.projects.find(
        (p) =>
          p.id !== c.assistant.project &&
          words(p.name).some((w) => normalize(question).includes(w)),
      );
      c.assistant.suggestions = {
        ...(suggestion ? { project: suggestion.id } : {}),
        archive: false,
      };
      await chatTransaction(async (rows) => {
        req.signal.throwIfAborted();
        const stored = rows.find((r) => r.id === c.id);
        if (!stored || stored.assistant?.revision !== c.assistant.revision - 1)
          throw Error("Conversation changed during this answer. Reload before retrying.");
        return { rows: rows.map((r) => (r.id === c.id ? c : r)), value: undefined };
      });
      await enqueueKeeper(c);
      return reply({
        conversation: c,
        usedMemories: supplied.map((m) => ({ id: m.id, title: m.title })),
        route: {
          provider: provider.kind,
          model: actualModel,
          search: search !== null,
          tool: tool !== null,
        },
        web,
        contextChars: JSON.stringify(messages).length,
        scrubbed: rawQuestion !== question,
      });
    } finally {
      running.delete(c.id);
      foregroundEnd();
    }
  } catch (e) {
    return reply(
      {
        error: req.signal.aborted
          ? "Request cancelled. Your question is saved."
          : e instanceof SyntaxError
            ? "Invalid request JSON"
            : e instanceof Error &&
                /Memory changed|Conversation changed|Approve|scope|Invalid|limit|Credentials|unavailable|Version/.test(
                  e.message,
                )
              ? e.message
              : "Assistant storage or processing failed. Existing data was kept; check persistent storage and retry.",
      },
      req.signal.aborted ? 499 : 400,
    );
  }
}


/** Owner-verified server-side bridge: no fabricated cookies or new public API.
 * Its persistent conversation is stored by the existing General Chat/Memory Keeper.
 * Discord is local-Ollama-only and cannot request tools, scopes, or provider changes.
 */
export async function askDiscordCompanion(question: string): Promise<{ ok: boolean; text: string }> {
  if (discordBusy) return { ok: false, text: "Pixel Pals is already answering another Discord question. Try again shortly." };
  discordBusy = true;
  try {
    const username = (await ownerName())?.toLowerCase();
    if (!username) return { ok: false, text: "Create the Pixel Pals owner account first." };
    const engine = await ownerEngineJson();
    if (!engine) return { ok: false, text: "Save your Local AI settings in Pixel Pals before chatting in Discord." };
    const internal: DiscordInternal = { ownerName: username };
    const call = (data: Record<string, unknown>) => handleAssistant(new Request("http://localhost/api/assistant", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    }), undefined, internal);
    let conversation = mine(await readChatRows(), username).find(c => c.mode === "discord" && c.assistant.status === "active");
    if (!conversation) {
      const created = await call({ op: "create", title: "Discord Companion" });
      const data = (await created.json()) as { conversation?: Conversation; error?: string };
      if (!created.ok || !data.conversation) return { ok: false, text: data.error ?? "Couldn't create Discord conversation." };
      conversation = data.conversation;
    }
    const res = await call({
      op: "ask", id: conversation.id, revision: conversation.assistant.revision,
      question: question.slice(0, 1800), engine: JSON.parse(engine) as unknown,
      provider: "ollama-server", research: false, web: "off", timeZone: process.env["BUDDY_TZ"] ?? "UTC",
    });
    const data = (await res.json()) as { conversation?: Conversation; error?: string };
    if (!res.ok || !data.conversation) return { ok: false, text: data.error ?? "Local AI couldn't answer. Check Ollama." };
    const last = data.conversation.messages.at(-1);
    return { ok: true, text: last ? messageString(last) : "No answer returned." };
  } catch {
    return { ok: false, text: "Pixel Pals couldn't answer. Check General Chat and Ollama." };
  } finally { discordBusy = false; }
}
