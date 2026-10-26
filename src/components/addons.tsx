import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceWindow } from "@/components/workspace-window";
import type { AddonInfo } from "@/lib/addons";

async function call<T>(url: string, body?: unknown): Promise<T & { error?: string }> {
  try {
    const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    return (await res.json()) as T & { error?: string };
  } catch { return { error: "Couldn't reach the server." } as T & { error?: string }; }
}

/** The add-ons found on the server (empty for anyone but the owner, or when there are none). */
export function useAddons(): { addons: AddonInfo[]; reload: () => Promise<void> } {
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const reload = useCallback(async () => {
    const res = await call<{ addons: AddonInfo[] }>("/api/addons?op=list");
    setAddons(res.error ? [] : res.addons ?? []);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { const on = () => void reload(); window.addEventListener("pixelpals:addons-changed", on); return () => window.removeEventListener("pixelpals:addons-changed", on); }, [reload]);
  return { addons, reload };
}

/** The window page of one add-on, in a sandboxed frame. Its pp.call(name, args) reaches the add-on's server code through here. */
function AddonFrame({ id }: { id: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const d = e.data as { ppCall?: boolean; id?: number; name?: string; args?: unknown } | null;
      if (!d?.ppCall || typeof d.id !== "number") return;
      const res = await call<{ result?: unknown }>("/api/addons", { op: "api", id, name: d.name, args: d.args });
      ref.current?.contentWindow?.postMessage({ ppReply: true, id: d.id, ...(res.error ? { error: res.error } : { result: res.result }) }, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id]);
  return <iframe ref={ref} title={`Add-on ${id}`} sandbox="allow-scripts" src={`/api/addons?op=window&id=${encodeURIComponent(id)}`} className="h-full min-h-72 w-full border-0 bg-background" />;
}

/** One workspace window per enabled add-on that has a window; `openId` says which is open. */
export function AddonWindows({ addons, openId, onClose, resetVersion }: { addons: AddonInfo[]; openId: string | null; onClose: () => void; resetVersion: number }) {
  return <>{addons.filter((a) => a.enabled && a.window).map((a) => (
    <Fragment key={a.id}><WorkspaceWindow id={`addon-${a.id}`} title={a.window?.title ?? a.name} icon={<Puzzle className="size-4" />} open={openId === a.id} onClose={onClose} resetVersion={resetVersion}>
      {openId === a.id && <AddonFrame id={a.id} />}
    </WorkspaceWindow></Fragment>
  ))}</>;
}

/** Settings: see what's installed, what each add-on asks for, and switch them on or off. */
export function AddonSettings() {
  const { addons, reload } = useAddons();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function act(op: "enable" | "disable", id: string) {
    setBusy(id); setError("");
    const res = await call<{ ok?: boolean }>("/api/addons", { op, id });
    if (res.error) setError(res.error);
    await reload();
    window.dispatchEvent(new Event("pixelpals:addons-changed"));
    setBusy("");
  }
  return (
    <section className="grid gap-2 rounded-md border p-3 text-xs" aria-label="Add-ons">
      <h3 className="flex items-center gap-1 text-sm font-semibold"><Puzzle className="size-4" /> Add-ons</h3>
      <p className="text-muted-foreground">Add-ons are folders in <code>addons/</code> inside your data folder. <b>An add-on runs code on your server</b>, so only turn on ones you wrote or trust. If an add-on's files change, it switches itself off until you approve it again.</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {addons.length === 0 && <p className="text-muted-foreground">None installed. Copy a folder (for example <code>examples/addons/hello</code> from the Pixel Pals repo) into <code>addons/</code> and reload.</p>}
      {addons.map((a) => (
        <div key={a.id} className="grid gap-1 rounded-md border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{a.name}</span>
            {a.version && <span className="text-muted-foreground">v{a.version}{a.author ? ` · ${a.author}` : ""}</span>}
            {a.problems.length === 0 && (a.enabled
              ? <Button size="sm" variant="outline" className="ml-auto h-7" disabled={busy === a.id} onClick={() => void act("disable", a.id)}>Turn off</Button>
              : <Button size="sm" className="ml-auto h-7" disabled={busy === a.id} onClick={() => void act("enable", a.id)}>{a.changed ? "Approve changes and turn on" : "Turn on"}</Button>)}
          </div>
          {a.description && <p>{a.description}</p>}
          {a.problems.length > 0 && <p className="text-destructive">Can't be used: {a.problems.join("; ")}.</p>}
          {a.changed && <p className="text-amber-500">This add-on's files changed since you approved it.</p>}
          {a.permissionText.length > 0 && <ul className="list-disc pl-4 text-muted-foreground">{a.permissionText.map((t) => <li key={t}>{t}</li>)}</ul>}
          {a.commands.length > 0 && <p className="text-muted-foreground">Commands: {a.commands.map((c) => `/${c.name}`).join(", ")}</p>}
        </div>
      ))}
    </section>
  );
}
