import { useEffect, useState } from "react";
import { Button } from "./ui/button";
type Snapshot = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  revision: number;
  imported: string;
};
export function CalendarUploads({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<Snapshot[]>([]),
    [name, setName] = useState(""),
    [color, setColor] = useState("#93d9b6"),
    [file, setFile] = useState<File | null>(null),
    [consent, setConsent] = useState(false),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const r = await fetch("/api/calendar?uploads=1");
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.snapshots)) throw Error(d.error);
      setRows(d.snapshots);
    } catch {
      setNote("Calendar snapshot storage is unavailable.");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const send = async (data: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch("/api/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.snapshots)) throw Error(d.error);
      setRows(d.snapshots);
      setNote("Calendar snapshot saved. Uploaded calendars do not refresh automatically.");
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="min-w-0 rounded border p-2">
      <summary className="cursor-pointer">Manage imported calendars</summary>
      <form
        className="mt-2 grid min-w-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file || file.size > 1000000 || !consent) return;
          void file
            .text()
            .then((body) => send({ op: "import", name, color, body, confirm: consent }))
            .catch(() => setNote("Could not read this file."));
        }}
      >
        <p className="text-xs">
          Import a personal or explicitly authorized work .ics snapshot. Nothing connects to
          Microsoft or writes back to calendars.
        </p>
        <label className="grid min-w-0 gap-1 text-xs">
          Calendar name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 w-full rounded border bg-background p-2"
          />
        </label>
        <label className="text-xs">
          Calendar color{" "}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label className="grid min-w-0 gap-1 text-xs">
          ICS file (up to 1 MB)
          <input
            className="min-w-0 w-full"
            type="file"
            accept=".ics,text/calendar"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setNote(f && f.size > 1000000 ? "Choose a file no larger than 1 MB." : "");
            }}
          />
        </label>
        <label className="text-xs">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          I have permission to store this calendar on my personal server
        </label>
        <Button size="sm" disabled={busy || !file || file.size > 1000000 || !consent}>
          Import snapshot
        </Button>
      </form>
      <div className="mt-2 grid min-w-0 gap-2">
        {rows.map((s) => (
          <label key={s.id} className="min-w-0 break-words text-xs">
            <input
              type="checkbox"
              checked={s.enabled}
              disabled={busy}
              onChange={(e) =>
                void send({
                  op: "visibility",
                  id: s.id,
                  revision: s.revision,
                  enabled: e.target.checked,
                })
              }
            />{" "}
            <span style={{ color: s.color }}>●</span> {s.name} · imported{" "}
            {new Date(s.imported).toLocaleDateString()}
          </label>
        ))}
      </div>
      <p role="status" className="mt-2 text-xs">
        {note}
      </p>
      <p className="text-xs text-muted-foreground">
        Unchecking hides events but retains the original snapshot. Eight snapshots maximum; old data
        is never automatically deleted.
      </p>
    </details>
  );
}
