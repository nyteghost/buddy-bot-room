import { randomUUID } from "node:crypto";
import { currentUser } from "./accounts.server";
import { todaySnapshot, updateToday } from "./today.server";
import {
  adaptiveDefaults,
  adaptiveId,
  cleanSession,
  compactText,
  parseAdaptive,
  preferencePatch,
} from "./adaptive-today";
import { keeperSnapshot } from "./keeper-store.server";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
/** Owner-only temporary work state in the existing Today store, never automatic permanent memory. */
export async function handleAdaptiveToday(request: Request): Promise<Response> {
  if (!(await currentUser(request))?.owner) return reply({ error: "Owner sign-in required." }, 403);
  if (!process.env["BUDDY_DATA_DIR"]?.trim())
    return reply({ error: "Persistent Today storage is unavailable." }, 404);
  try {
    const snapshot = await todaySnapshot();
    if (request.method === "GET")
      return reply({
        adaptive: snapshot.adaptive ?? adaptiveDefaults(),
        projects: (await keeperSnapshot()).projects,
      });
    if (request.method !== "POST") return reply({ error: "Unsupported operation." }, 405);
    const raw = await request.text();
    if (raw.length > 32000) return reply({ error: "Request too large." }, 413);
    const data = JSON.parse(raw) as Record<string, unknown>;
    const project = compactText(data["project"], 80);
    if (project && !(await keeperSnapshot()).projects.some((p) => p.id === project))
      return reply({ error: "Choose an existing authorized project." }, 400);
    let changed = "";
    const saved = await updateToday((state) => {
      const a = parseAdaptive(state.adaptive ?? adaptiveDefaults());
      if (data["revision"] !== a.revision)
        throw Error("Today changed on another device. Reload before saving; your edits are kept.");
      if (data["op"] === "preferences") {
        state = {
          ...state,
          adaptive: preferencePatch(
            a,
            data["patch"] && typeof data["patch"] === "object"
              ? (data["patch"] as Record<string, unknown>)
              : {},
          ),
        };
      } else {
        const id = adaptiveId(data["id"]) ? data["id"] : randomUUID();
        const existing = a.checkpoints.find((c) => c.id === id);
        if (data["op"] === "delete") {
          if (!existing) throw Error("Checkpoint not found.");
          a.checkpoints = a.checkpoints.filter((c) => c.id !== id);
        } else if (data["op"] === "restore") {
          const n = Number(data["index"]),
            old = Number.isInteger(n) ? existing?.history[n] : null;
          if (!existing || !old) throw Error("Checkpoint version not found.");
          const { history, ...before } = existing;
          Object.assign(existing, old, {
            revision: before.revision + 1,
            updated: Date.now(),
            history: [...history, before].slice(-3),
          });
        } else if (data["op"] === "checkpoint") {
          const session = cleanSession(data["session"]);
          if (!session) throw Error("Review a valid task and next step.");
          if (!existing && a.checkpoints.length >= 30)
            throw Error("Checkpoint limit reached. Remove an old checkpoint first.");
          const next = {
            id,
            revision: (existing?.revision ?? 0) + 1,
            updated: Date.now(),
            session,
            project: existing?.project ?? "",
            state: existing?.state ?? "",
            decisions: existing?.decisions ?? "",
            blockers: existing?.blockers ?? "",
            sources: existing?.sources ?? "",
            history: existing?.history ?? [],
          };
          if (existing) {
            const { history: _, ...before } = existing;
            void _;
            next.history = [...next.history, before].slice(-3);
          }
          if (data["manual"] === true) {
            next.project = project;
            for (const key of ["state", "decisions", "blockers", "sources"] as const)
              next[key] = compactText(data[key]);
          }
          a.checkpoints = [next, ...a.checkpoints.filter((c) => c.id !== id)];
          changed = id;
        } else throw Error("Unsupported operation.");
        state = { ...state, adaptive: a };
      }
      state.adaptive!.revision = a.revision + 1;
      return state;
    });
    return reply({ adaptive: saved.adaptive, id: changed });
  } catch (e) {
    const error = e instanceof Error ? e.message : "";
    return reply(
      {
        error: /Today changed|Checkpoint|Review|Unsupported|Invalid/.test(error)
          ? error
          : "Today storage could not be read or saved. Existing data was kept.",
      },
      error.includes("changed") ? 409 : 400,
    );
  }
}
