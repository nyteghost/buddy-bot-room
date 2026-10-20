import { parseServiceKeyFile } from "@/lib/gcal";
import { BackupSection, SchedulesSection } from "@/components/maintenance-panels";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Circle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { groupItems, setupSummary, type SetupItem, type SetupTest } from "@/lib/setup";
import { setHideSecrets, useHideSecrets } from "@/lib/privacy-store";
import type { SettingState } from "@/lib/settings";

/** What's connected and what isn't. Each card opens its settings (saved on the server; secrets are write-only and never sent back), with a Test button. */
export function SetupPanel({ open }: { open: boolean }) {
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, SetupTest | "running">>({});
  const hide = useHideSecrets();
  const [fields, setFields] = useState<SettingState[]>([]);
  const [openId, setOpenId] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>(["basics"]);
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState("");
  const [saveNote, setSaveNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/setup");
      const json = (await res.json()) as { items?: SetupItem[]; error?: string };
      if (json.items) { setItems(json.items); setError(""); } else setError(json.error ?? "Couldn't load.");
    } catch { setError("Couldn't reach the server."); }
  }, []);
  const loadFields = useCallback(async () => {
    try {
      const json = (await (await fetch("/api/settings")).json()) as { settings?: SettingState[] };
      if (json.settings) setFields(json.settings);
    } catch { /* the cards still work without the form */ }
  }, []);
  useEffect(() => { if (open) { void load(); void loadFields(); } }, [open, load, loadFields]);
  const save = async (id: string, keys: string[]) => {
    const values: Record<string, string | null> = {};
    for (const k of keys) if (k in drafts) values[k] = drafts[k] ?? null;
    if (!Object.keys(values).length) { setSaveNote((n) => ({ ...n, [id]: "Nothing changed." })); return; }
    setSaving(id);
    try {
      const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ values }) });
      const json = (await res.json()) as { settings?: SettingState[]; saved?: string[]; errors?: Record<string, string>; error?: string };
      if (json.settings) setFields(json.settings);
      const problems = Object.values(json.errors ?? {});
      setSaveNote((n) => ({ ...n, [id]: json.error ?? (problems.length ? `⚠ ${problems.join(" ")}` : "✅ Saved. No redeploy needed.") }));
      if (!problems.length) setDrafts((d) => { const next = { ...d }; for (const k of keys) delete next[k]; return next; });
      await load();
    } catch { setSaveNote((n) => ({ ...n, [id]: "⚠ Couldn't reach the server." })); }
    setSaving("");
  };
  const test = async (id: string) => {
    setResults((r) => ({ ...r, [id]: "running" }));
    try {
      const res = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const out = (await res.json()) as SetupTest;
      setResults((r) => ({ ...r, [id]: out }));
    } catch { setResults((r) => ({ ...r, [id]: { ok: false, note: "Couldn't reach the server." } })); }
  };
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState("");
  /** Tests every integration that is set up and says which ones need attention. */
  const checkAll = async () => {
    if (!items) return;
    const targets = items.filter((i) => i.configured && i.testable);
    setChecking(true); setHealth("");
    setResults((r) => ({ ...r, ...Object.fromEntries(targets.map((t) => [t.id, "running" as const])) }));
    const out = await Promise.all(targets.map(async (t) => {
      try {
        const res = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: t.id }) });
        return [t, (await res.json()) as SetupTest] as const;
      } catch { return [t, { ok: false, note: "Couldn't reach the server." }] as const; }
    }));
    setResults((r) => ({ ...r, ...Object.fromEntries(out.map(([t, v]) => [t.id, v])) }));
    const bad = out.filter(([, v]) => !v.ok).map(([t]) => t.name);
    const notSet = items.filter((i) => !i.configured).length;
    setHealth(targets.length === 0 ? "Nothing is set up yet." : bad.length ? `⚠ ${out.length - bad.length} of ${out.length} working. Needs attention: ${bad.join(", ")}.` : `✅ All ${out.length} connected integrations are working.${notSet ? ` (${notSet} more aren't set up.)` : ""}`);
    setChecking(false);
  };
  const renderItem = (i: SetupItem) => {
        const r = results[i.id];
        const mine = fields.filter((f) => f.group === i.id);
        const isOpen = openId === i.id;
        return (
          <div key={i.id} className="grid gap-1 rounded-md border px-3 py-2">
            <div className="flex items-center gap-2">
              {i.configured ? <CheckCircle2 className="size-4 shrink-0 text-green-500" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
              {mine.length > 0 && <Button size="sm" variant="ghost" className="h-7" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? "" : i.id)}>{i.configured ? "Edit" : "Set up"}<ChevronDown className={`ml-1 size-3 transition-transform ${isOpen ? "rotate-180" : ""}`} /></Button>}
              {i.testable && i.configured && <Button size="sm" variant="outline" className="h-7" disabled={r === "running"} onClick={() => void test(i.id)}>{r === "running" ? <Loader2 className="size-3 animate-spin" /> : "Test"}</Button>}
            </div>
            <span className="text-xs text-muted-foreground">{i.what}{i.configured ? "" : mine.length ? " · not set up yet" : ` · set ${i.env} in Portainer`}</span>
            {isOpen && (
              <form className="mt-1 grid gap-2 border-t pt-2" onSubmit={(e) => { e.preventDefault(); void save(i.id, mine.map((f) => f.key)); }}>
                {i.id === "imap" && (
                  <div className="grid gap-1 rounded-md bg-muted/40 p-2 text-xs">
                    <span>Using Gmail? Press the button, add your address and an app password, then Save.</span>
                    <Button type="button" size="sm" variant="outline" className="h-7 w-fit" onClick={() => setDrafts((d) => ({ ...d, ...Object.fromEntries(([["IMAP_HOST", "imap.gmail.com"], ["IMAP_PORT", "993"], ["SMTP_HOST", "smtp.gmail.com"], ["SMTP_PORT", "465"]] as const).filter(([k]) => mine.find((f) => f.key === k)?.source !== "env")) }))}>Fill in for Gmail</Button>
                  </div>
                )}
                {i.id === "gcal" && (
                  <div className="grid gap-1 rounded-md bg-muted/40 p-2 text-xs">
                    <span>Using a service account? Choose the JSON key file you downloaded from Google Cloud. It fills in the email and key below; then add your calendar address and Save. The file stays in your browser until you press Save.</span>
                    <label className="w-fit cursor-pointer rounded-md border bg-background px-3 py-1 text-xs font-medium hover:bg-muted">
                      Choose key file…
                      <input type="file" accept=".json,application/json" className="sr-only" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        if (file.size > 20_000) { setError("That file is too big to be a Google key file."); return; }
                        const parsed = parseServiceKeyFile(await file.text());
                        if (!parsed) { setError("That isn't a Google service account key file (it should be the .json you downloaded)."); return; }
                        setError("");
                        setDrafts((d) => ({ ...d, ...(mine.find((f) => f.key === "GOOGLE_SA_EMAIL")?.source !== "env" ? { GOOGLE_SA_EMAIL: parsed.email } : {}), ...(mine.find((f) => f.key === "GOOGLE_SA_KEY")?.source !== "env" ? { GOOGLE_SA_KEY: parsed.key } : {}) }));
                      }} />
                    </label>
                  </div>
                )}
                {mine.map((f) => {
                  const locked = f.source === "env";
                  const draft = drafts[f.key];
                  const shown = draft !== undefined ? (draft ?? "") : f.secret ? "" : (f.value ?? "");
                  const set = (v: string | null) => setDrafts((d) => ({ ...d, [f.key]: v }));
                  return (
                    <label key={f.key} className="grid gap-1 text-xs">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{f.label}</span>
                        {locked && <span className="text-muted-foreground">set in Portainer, change it there</span>}
                        {!locked && f.secret && f.source === "app" && draft === undefined && <span className="text-muted-foreground">saved ✓ (hidden)</span>}
                        {!locked && f.secret && f.source === "app" && draft !== null && <button type="button" className="ml-auto text-destructive underline" onClick={() => set(null)}>Clear</button>}
                        {draft === null && <span className="text-destructive">will be cleared</span>}
                      </span>
                      {f.kind === "select" ? (
                        <select className="h-9 rounded-md border bg-background px-2 text-sm" disabled={locked} value={shown} onChange={(e) => set(e.target.value)}>
                          <option value="">{f.source === "none" || draft === "" ? "Not set" : "Not set"}</option>
                          {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <Input
                          type={f.secret ? "password" : "text"}
                          autoComplete="off"
                          disabled={locked || draft === null}
                          placeholder={f.secret && f.source === "app" ? "Type to replace" : f.placeholder}
                          value={shown}
                          onChange={(e) => set(e.target.value)}
                        />
                      )}
                      {f.help && <span className="text-muted-foreground">{f.help}</span>}
                    </label>
                  );
                })}
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={saving === i.id}>{saving === i.id ? <Loader2 className="size-3 animate-spin" /> : "Save"}</Button>
                  {saveNote[i.id] && <span className="text-xs">{saveNote[i.id]}</span>}
                </div>
              </form>
            )}
            {r && r !== "running" && <span className={r.ok ? "text-xs text-green-600 dark:text-green-400" : "text-xs text-destructive"}>{r.ok ? "✅" : "⚠"} {r.note}</span>}
          </div>
        );
  };
  return (
    <div className="grid gap-3 p-3 text-sm">
      {error && <p className="text-destructive">{error}</p>}
      {items && <p className="font-medium">{setupSummary(items)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={checking || !items} onClick={() => void checkAll()}>{checking ? <Loader2 className="size-3 animate-spin" /> : null} Is everything connected?</Button>
        {health && <span className="text-xs">{health}</span>}
      </div>
      <label className="flex items-center gap-2 rounded-md border px-3 py-2">
        <input type="checkbox" checked={hide} onChange={(e) => setHideSecrets(e.target.checked)} />
        <span>Hide secrets on this device <span className="text-xs text-muted-foreground">(blurs links and addresses so screenshots are safe)</span></span>
      </label>
      {items && groupItems(items).map((g) => {
        const expanded = openGroups.includes(g.id);
        return (
          <section key={g.id} className="rounded-md border">
            <button type="button" aria-expanded={expanded} className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpenGroups((list) => (list.includes(g.id) ? list.filter((x) => x !== g.id) : [...list, g.id]))}>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{g.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{g.blurb}</span>
              </span>
              {g.items.length > 0 && <span className={`shrink-0 text-xs ${g.on === g.items.length ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>{g.on} of {g.items.length} set up</span>}
              <ChevronDown className={`size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded && (
              <div className="grid gap-2 border-t p-2">
                {g.items.map(renderItem)}
                {g.id === "maintenance" && <><BackupSection open={open} /><SchedulesSection open={open} /></>}
              </div>
            )}
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">Settings you save here are kept on the server and take effect right away. A value set in Portainer wins and is locked here. Keys and passwords are write-only and are left out of backups. Things the stack itself needs (COMPOSE_PROFILES, Tailscale, the Radicale password, the Ollama runtime) stay in Portainer.</p>
    </div>
  );
}
