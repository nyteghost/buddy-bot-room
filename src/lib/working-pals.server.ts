import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { currentUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { jobs } from "./jobs.server";
import { canRun, MAX_MISSIONS, newMission, recoverMission, validMission, type PalMission } from "./working-pals";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const path = () => dir() + "/working-pals.json";
let chain: Promise<unknown> = Promise.resolve();
const serialize = <T,>(task: () => Promise<T>): Promise<T> => {
  const pending = chain.then(task, task);
  chain = pending.catch(() => undefined);
  return pending;
};
async function load(): Promise<PalMission[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(path(), "utf8"));
    if (!Array.isArray(raw)) throw Error("Invalid Working Pals database");
    if (raw.length > MAX_MISSIONS || !raw.every(validMission)) throw Error("Working Pals database needs repair");
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
    for (let i=0;i<rows.length;i++) {
      const mission = rows[i]!;
      if (mission.status === "running" && !jobs().state("working:" + mission.id)?.running) rows[i] = recoverMission(mission);
    }
    return structuredClone(rows);
  });
}
function errorText(e: unknown) { return e instanceof Error ? e.message.slice(0, 180) : "Couldn't complete this request"; }
function modify(rows: PalMission[], id: string, expected: number, action: "approve" | "revoke" | "pause"): PalMission | null {
  const m = rows.find(row=>row.id===id);
  if (!m || m.revision !== expected) return null;
  if (action==="approve" && m.status!=="proposed") return null;
  if (action==="pause" && m.status!=="running") return null;
  if (action==="revoke" && m.status==="revoked") return null;
  m.status = action==="approve" ? "approved" : action==="revoke" ? "revoked" : "paused";
  m.updated = new Date().toISOString(); m.revision++;
  if (action==="approve") m.approvedAt = m.updated;
  if (action==="revoke" || action==="pause") jobs().cancel("working:"+id);
  return structuredClone(m);
}
async function execute(id: string, expected: number): Promise<{ ok: boolean; message: string }> {
  const start = await transaction(rows => {
    const m=rows.find(x=>x.id===id);
    if (!m || m.revision!==expected || !canRun(m)) return false;
    m.status="running";m.startedAt=new Date().toISOString();m.updated=m.startedAt;
    m.finishedAt="";m.error="";m.revision++;
    return true;
  });
  if (!start) return { ok:false,message:"This job changed or needs your approval. Refresh to review it." };
  const runResult = await jobs().run("working:"+id,async signal=>{
    const current=(await listMissions()).find(m=>m.id===id);
    if (!current || current.status!=="running") return;
    const response=await askPals(current.question,{
      localOnly:true, signal, maxTokens:900,
      system:"You are a Working Pal performing a specifically approved, READ-ONLY local summary. No browsing, tools, file writes, calendar changes, messaging, external actions, hidden work or claims that actions were done. Answer with a practical summary. Cite only sources actually supplied; say when you lack information. Keep it under 350 words.",
    });
    await transaction(rows=>{
      const m=rows.find(x=>x.id===id);
      if (!m || m.status!=="running") return;
      m.finishedAt=new Date().toISOString();m.updated=m.finishedAt;m.revision++;
      if (!response.ok) {m.status="failed";m.error=response.error.slice(0,300);}
      else {m.status="completed";m.result=response.text.slice(0,4000);m.error="";}
    });
  },{ timeoutMs:180_000,lane:"inference",laneLimit:1,retries:0 });
  if (runResult!=="done") {
    await transaction(rows=>{
      const m=rows.find(x=>x.id===id);
      if (!m || m.status!=="running") return; // Never override revoked/paused state.
      m.finishedAt=new Date().toISOString();m.updated=m.finishedAt;
      m.status=runResult==="cancelled" ? "paused" : "failed";
      m.error=runResult==="timeout" ? "Local AI timed out. You can retry." : "Job stopped before completion.";
      m.revision++;
    });
  }
  return { ok: runResult==="done", message:runResult==="done" ? "Job finished. Check its recorded result." : "Job stopped; its state was saved." };
}
/** Owner-only, explicitly approved, read-only Working Pals inbox. */
export async function handleWorkingPals(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error:"Only the owner can manage Working Pals." },{status:403});
  if (!dir()) return Response.json({error:"Working Pals requires BUDDY_DATA_DIR."},{status:503});
  try {
    if (request.method==="GET") return Response.json({ missions:await listMissions() });
    if (request.method!=="POST") return new Response(null,{status:405});
    const body=(await request.json().catch(()=>({}))) as Record<string,unknown>;
    const op=body["op"];
    if (op==="propose") {
      const mission=newMission(body,randomUUID(),new Date().toISOString());
      if (!mission) return Response.json({error:"Add a title, a short read-only question and a valid scope/project."},{status:400});
      const created=await transaction(rows=>{
        if (rows.length>=MAX_MISSIONS) return false;
        rows.unshift(mission);return true;
      });
      return created ? Response.json({mission,status:"proposed"}) : Response.json({error:"Inbox full. Resolve or remove older jobs first."},{status:409});
    }
    if (!["approve","revoke","pause","run"].includes(String(op))) return Response.json({error:"Unknown operation."},{status:400});
    const id=typeof body["id"]==="string" ? body["id"] : "";
    const revision=body["revision"];
    if (!/^[0-9a-f-]{36}$/i.test(id) || typeof revision!=="number" || !Number.isInteger(revision)) return Response.json({error:"Invalid job or revision."},{status:400});
    if (op==="run") {
      const result=await execute(id,revision);
      return Response.json(result,{status:result.ok?200:409});
    }
    const result=await transaction(rows=>modify(rows,id,revision,op as "approve"|"revoke"|"pause"));
    return result ? Response.json({mission:result}) : Response.json({error:"Job changed or that action is not allowed. Refresh before retrying."},{status:409});
  } catch(e) {
    return Response.json({error:"Working Pals couldn't save this change: "+errorText(e)},{status:500});
  }
}
