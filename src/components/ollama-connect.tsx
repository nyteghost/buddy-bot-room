import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { setEngine, useEngine } from "@/lib/engine";
import { ollamaConnectUrl, OLLAMA_PC_SETUP } from "@/lib/ollama-connect";
import type { SettingState } from "@/lib/settings";
export function OllamaConnect({ onConnected }: { onConnected?: () => void }) {
  const engine = useEngine();
  const [url, setUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [tested, setTested] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [allowed, setAllowed] = useState(true);
  const pending = useRef<AbortController | null>(null);
  const edited = useRef(false);
  const cancel = () => { pending.current?.abort(); pending.current = null; setBusy(false); };
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings", { signal: controller.signal }).then(async response => {
      if (response.status === 403) { setAllowed(false); return; }
      const json = await response.json() as { settings?: SettingState[] };
      const saved = json.settings?.find(x => x.key === "OLLAMA_URL")?.value;
      if (!edited.current && !controller.signal.aborted && saved) setUrl(saved);
    }).catch(() => { /* The connection form remains usable if settings loading failed. */ });
    return () => { controller.abort(); pending.current?.abort(); };
  }, []);
  const run = async (op: "test" | "connect") => {
    const base = ollamaConnectUrl(url); if (!base) { setNote("Enter your PC’s Ollama address, for example http://192.168.1.50:11434. Use its LAN address when Pixel Pals runs on Unraid."); return; }
    cancel(); const controller = new AbortController(); pending.current = controller; setBusy(true); setNote("");
    try {
      const response = await fetch("/api/ollama-connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, url: base, ...(op === "connect" ? { model } : {}) }), signal: controller.signal });
      const data = await response.json() as { ok?: boolean; saved?: boolean; url?: string; models?: string[]; model?: string; error?: string; note?: string };
      if (controller.signal.aborted || pending.current !== controller) return;
      if (!response.ok || !data.ok) { setTested(""); setModels([]); setNote(data.error ?? "Connection failed. Try again; your previous address stays saved."); return; }
      const list = (data.models ?? []).filter(x => typeof x === "string");
      setUrl(base); setModels(list); setModel(list.includes(model) ? model : list.includes(engine.localChat) ? engine.localChat : list[0] ?? ""); setTested(base);
      if (op === "connect" && data.saved && data.model === model) {
        setEngine({ kind: "local-server", localChat: model, localAuto: false });
        setNote("Saved and connected. Pixel Pals now uses your PC’s Ollama through its server. No redeploy needed. Advanced per-Pal model overrides stay unchanged.");
        window.dispatchEvent(new Event("pixelpals:ollama-connected")); onConnected?.();
      } else setNote(data.note ?? "Connection works. Choose a model, then Save and connect.");
    } catch { if (!controller.signal.aborted) setNote("Could not contact Pixel Pals. Nothing was changed; try again."); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  return <section className="grid min-w-0 gap-3 rounded-lg border p-3 text-sm" aria-label="Connect Ollama">
    <h3 className="font-semibold">Connect Ollama</h3>
    <p className="text-xs text-muted-foreground">Ollama on a PC, Pixel Pals on Unraid? Enter the PC’s LAN address here. The connection is tested from Pixel Pals’ server, so it also works from your phone.</p>
    {!allowed ? <p role="status">Sign in as the owner to save or test the server connection.</p> : <>
      <label className="grid min-w-0 gap-1">Ollama server address<Input className="secret" type="url" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={1000} value={url} placeholder="http://your-pc-ip:11434" onChange={e => { edited.current = true; cancel(); setUrl(e.target.value); setModels([]); setModel(""); setTested(""); setNote(""); }} /></label>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void run("test")}>Test connection</Button><Button type="button" disabled={busy || !model || tested !== ollamaConnectUrl(url)} onClick={() => void run("connect")}>Save and connect</Button>{busy && <Button type="button" variant="ghost" onClick={cancel}>Cancel request</Button>}</div>
      {models.length > 0 && <label className="grid gap-1">Installed local model<select className="min-w-0 rounded-md border bg-background p-2 text-base" value={model} disabled={busy} onChange={e => setModel(e.target.value)}>{models.map(x => <option key={x} value={x}>{x}</option>)}</select></label>}
      {!model && <p className="text-xs text-muted-foreground">Test the address to list installed models and enable Save and connect. Testing does not save or switch engines.</p>}
    </>}
    {(busy || note) && <p role="status" className="whitespace-pre-wrap break-words text-xs">{busy ? "Checking the connection from Pixel Pals…" : note}</p>}
    <details><summary className="cursor-pointer py-2">PC not reachable? CachyOS / Fish setup</summary><p className="my-2 text-xs">For Ollama installed as a system service, run these commands on the PC, then test again. This restarts Ollama and allows LAN connections. Keep port 11434 on your trusted network; no router port-forward is needed.</p><pre className="max-w-full overflow-x-auto rounded border p-2 text-xs"><code>{OLLAMA_PC_SETUP}</code></pre><Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(OLLAMA_PC_SETUP); setNote("PC setup commands copied. Run them on the PC, then Test connection."); } catch { setNote("Clipboard unavailable. Select the commands above and copy them manually."); } }}>Copy PC setup commands</Button></details>
  </section>;
}
