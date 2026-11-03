import { CalendarUploads } from "./calendar-uploads";
import { OllamaConnect } from "./ollama-connect";
import { AddonSettings } from "@/components/addons";
import { WorkingPalsPanel } from "@/components/working-pals-panel";
import { parseServiceKeyFile } from "@/lib/gcal";
import { BackupSection, SchedulesSection } from "@/components/maintenance-panels";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Circle, Loader2, Search, X, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { groupItems, SETUP_GROUPS, setupSummary, filterSetupItems, type SetupItem, type SetupTest } from "@/lib/setup";
import { setHideSecrets, useHideSecrets } from "@/lib/privacy-store";
import type { SettingState } from "@/lib/settings";

/** What's connected and what isn't. Each card opens its settings (saved on the server; secrets are write-only and never sent back), with a Test button. */
export function SetupPanel({ open, focus }: { open: boolean; focus?: { id: string; request: number } | null }) {
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, SetupTest | "running">>({});
  const hide = useHideSecrets();
  const [fields, setFields] = useState<SettingState[]>([]);
  const [openId, setOpenId] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("basics");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "configured" | "unconfigured">("all");
  const [showDetails, setShowDetails] = useState(false);
  const focusedRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !items || !focus || focusedRequest.current === focus.request) return;
    const group = SETUP_GROUPS.find(g => g.ids.includes(focus.id));
    if (!group) return;
    focusedRequest.current = focus.request;
    setSelectedGroup(group.id);
    setSearch("");
    setStatusFilter("all");
    setOpenId(focus.id);
    const frame=requestAnimationFrame(() => document.querySelector(`[data-integration-id="${focus.id}"]`)?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [open, items, focus]);
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
      if (id === "ollama") window.dispatchEvent(new Event("pixelpals:ollama-connected"));
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
          <div key={i.id} data-integration-id={i.id} className="grid gap-1 rounded-md border px-3 py-2">
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
                  const locked = false; // anything can be typed here; a saved value wins over the stack's own
                  const draft = drafts[f.key];
                  const shown = draft !== undefined ? (draft ?? "") : f.secret ? "" : (f.value ?? "");
                  const set = (v: string | null) => setDrafts((d) => ({ ...d, [f.key]: v }));
                  return (
                    <label key={f.key} className="grid gap-1 text-xs">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{f.label}</span>
                        {f.source === "env" && <span className="text-muted-foreground">using the stack's value, type here to override</span>}
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
                      {f.help && (
                        <details className="text-muted-foreground">
                          <summary className="w-fit cursor-pointer select-none text-xs hover:underline">What does this setting do?</summary>
                          <p className="mt-1 leading-relaxed">{f.help}</p>
                        </details>
                      )}
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
  const allGroups = items ? groupItems(items) : [];
  const searching = search.trim().length > 0;
  const filtered = items ? filterSetupItems(items, fields, search, statusFilter) : [];
  const selected = allGroups.find((g) => g.id === selectedGroup) ?? (selectedGroup === "addons" || selectedGroup === "working-pals" ? undefined : allGroups[0]);
  const shown = searching
    ? filtered
    : filtered.filter((i) => selected?.items.some((member) => member.id === i.id));
  const selectionLabel = selected?.name ?? "Integrations";

  return (
    <div className="grid gap-3 p-3 text-sm">
      <header className="grid gap-1">
        <h2 className="text-base font-semibold">Settings</h2>
        <p className="text-xs text-muted-foreground">Find what you need. All existing integrations and saved settings are preserved.</p>
        {items && <p className="text-xs text-muted-foreground">{setupSummary(items)}</p>}
      </header>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={checking || !items} onClick={() => void checkAll()}>{checking ? <Loader2 className="mr-1 size-3 animate-spin" /> : null} Check connections</Button>
        <Button size="sm" variant="ghost" onClick={() => { void load(); void loadFields(); }}>Refresh status</Button>
      </div>
      {health && <p role="status" className="rounded-md border px-3 py-2 text-xs">{health}</p>}
      <label className="relative grid gap-1">
        <span className="font-medium">Find a setting</span>
        <span className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <Input aria-label="Find a setting" className="pl-9 pr-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Discord, calendar, passwords, memory…" />
          {search && <button type="button" aria-label="Clear settings search" className="absolute right-2 rounded p-1 hover:bg-muted" onClick={() => setSearch("")}><X className="size-4" /></button>}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Settings status filter">
        {([["all", "All"], ["configured", "Connected"], ["unconfigured", "Not set up"]] as const).map(([value, label]) => (
          <Button key={value} size="sm" variant={statusFilter === value ? "default" : "outline"} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</Button>
        ))}
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(160px,210px)_minmax(0,1fr)]">
        <nav aria-label="Settings categories" className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
          {allGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-current={!searching && selected?.id === g.id ? "page" : undefined}
              className={`flex min-w-fit items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted md:min-w-0 ${!searching && selected?.id === g.id ? "border-primary bg-primary/10 font-medium" : "border-transparent"}`}
              onClick={() => { setSelectedGroup(g.id); setSearch(""); setStatusFilter("all"); setOpenId(""); }}
            >
              <span className="truncate">{g.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{g.on}/{g.items.length}</span>
            </button>
          ))}
          <button
            type="button"
            aria-current={!searching && selectedGroup === "addons" ? "page" : undefined}
            className={`min-w-fit rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted ${!searching && selectedGroup === "addons" ? "border-primary bg-primary/10 font-medium" : "border-transparent"}`}
            onClick={() => { setSelectedGroup("addons"); setSearch(""); setStatusFilter("all"); setOpenId(""); }}
          >Add-ons</button>
          <button type="button" aria-current={!searching && selectedGroup === "working-pals" ? "page" : undefined}
            className={`min-w-fit rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted ${!searching && selectedGroup === "working-pals" ? "border-primary bg-primary/10 font-medium" : "border-transparent"}`}
            onClick={() => {setSelectedGroup("working-pals");setSearch("");setStatusFilter("all");setOpenId("");}}>
            Working Pals
          </button>
        </nav>
        <main className="grid min-w-0 content-start gap-3 rounded-xl border p-3" aria-label="Selected settings">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">{searching ? `Search results for “${search.trim()}”` : selectedGroup === "addons" ? "Add-ons" : selectedGroup === "working-pals" ? "Working Pals" : selectionLabel}</h3>
              {!searching && selected && <p className="text-xs text-muted-foreground">{selected.blurb}</p>}
            </div>
            <Button size="sm" variant="ghost" aria-pressed={showDetails} onClick={() => setShowDetails(!showDetails)}><SlidersHorizontal className="mr-1 size-3" /> {showDetails ? "Hide details" : "Show details"}</Button>
          </div>
          {showDetails && (
            <div className="grid gap-2 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={hide} onChange={(e) => setHideSecrets(e.target.checked)} />
                Hide sensitive values on this device
              </label>
              <p>Saved values take effect without editing Docker. Credentials stay server-side. Some stack-only settings still require editing Unraid Compose.</p>
            </div>
          )}
          {!searching && selected?.id === "basics" && <OllamaConnect onConnected={() => { void load(); void loadFields(); }} />}
          {!searching && selected?.id === "calendar-mail" && <CalendarUploads onChanged={()=>void load()}/>}
          {!searching && selectedGroup === "addons" ? <AddonSettings /> : !searching && selectedGroup === "working-pals" ? <WorkingPalsPanel open={open} /> : (
            <div className="grid min-w-0 content-start gap-2">
              {shown.length ? shown.map(renderItem) : <p className="rounded-md border p-3 text-sm text-muted-foreground">No settings match this view. Try All or clear the search.</p>}
              {!searching && selected?.id === "maintenance" && <><BackupSection open={open} /><SchedulesSection open={open} /></>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
