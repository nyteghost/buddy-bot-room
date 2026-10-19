import { useState } from "react";
import { ClipboardPaste, ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setEngine, useEngine } from "@/lib/engine";
import { KEY_PROVIDERS, cleanKey, detectProvider, keyCount, type KeyProvider } from "@/lib/key-providers";

type Status = { state: "testing" } | { state: "ok" | "bad"; message: string };

async function testKey(provider: KeyProvider, key: string): Promise<Status> {
  try {
    const res = await fetch("/api/keytest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: provider.id, key }) });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    return { state: data.ok ? "ok" : "bad", message: data.message ?? (data.ok ? "Works." : "Didn't work.") };
  } catch {
    return { state: "bad", message: "Couldn't reach the Pixel Pals server." };
  }
}

/** Per-provider key pages, paste-to-detect, and a Test button. Keys are saved through the normal engine settings. */
export function FreeKeysWizard() {
  const engine = useEngine();
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState("");

  async function run(provider: KeyProvider, key: string) {
    setStatus((s) => ({ ...s, [provider.id]: { state: "testing" } }));
    const result = await testKey(provider, key);
    setStatus((s) => ({ ...s, [provider.id]: result }));
  }

  function accept(text: string) {
    const key = cleanKey(text);
    if (!key) return;
    const provider = detectProvider(key);
    if (!provider) { setNote("That doesn't look like a Groq, Gemini, OpenRouter or NVIDIA key. Paste it into the matching box below."); return; }
    setEngine({ [provider.field]: key });
    setPaste("");
    setNote(`Saved as your ${provider.name} key. Testing…`);
    void run(provider, key);
  }

  async function fromClipboard() {
    try {
      accept(await navigator.clipboard.readText());
    } catch {
      setNote("Your browser didn't allow reading the clipboard. Paste the key into the box instead.");
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Get free keys ({keyCount(engine)} of {KEY_PROVIDERS.length})</span>
      </div>
      <p className="text-muted-foreground">
        Each provider needs you to sign in once and create a key on their site (Pixel Pals can't do that part for you). Tap <b>Open key page</b>, copy the key, then come back and paste it below. It's matched to the right provider and tested automatically.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          aria-label="Paste any free key"
          placeholder="Paste a key here…"
          value={paste}
          onChange={(e) => { setPaste(e.target.value); if (detectProvider(e.target.value)) accept(e.target.value); }}
        />
        <Button type="button" variant="secondary" onClick={() => void fromClipboard()}><ClipboardPaste className="size-4" /> Add from clipboard</Button>
      </div>
      {note && <p className="text-muted-foreground">{note}</p>}
      <div className="grid gap-2">
        {KEY_PROVIDERS.map((p) => {
          const key = engine[p.field].trim();
          const st = status[p.id];
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.free}</div>
              </div>
              <div className="flex items-center gap-2">
                {st?.state === "testing" && <Loader2 className="size-4 animate-spin" aria-label="Testing" />}
                {st?.state === "ok" && <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle2 className="size-4" /> {st.message}</span>}
                {st?.state === "bad" && <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="size-4" /> {st.message}</span>}
                {!st && key && <span className="text-xs text-muted-foreground">Key saved</span>}
                {key && <Button type="button" size="sm" variant="ghost" className="h-11 sm:h-8" onClick={() => void run(p, key)}>Test</Button>}
                <Button asChild size="sm" variant="outline" className="h-11 sm:h-8">
                  <a href={p.url} target="_blank" rel="noreferrer">Open key page <ExternalLink className="size-3" /></a>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
