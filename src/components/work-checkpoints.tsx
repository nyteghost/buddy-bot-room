import { useState } from "react";
import { Button } from "./ui/button";
import { useAdaptiveToday, changeAdaptive, refreshAdaptive } from "@/lib/adaptive-store";
import type { Checkpoint } from "@/lib/adaptive-today";
import type { FocusSession } from "@/lib/focus-companion";
import { useFocusCheckpoint } from "@/lib/focus-checkpoint-store";
export function WorkCheckpoints({
  onResume,
}: {
  onResume?: ((s: FocusSession) => void) | undefined;
}) {
  const { adaptive, projects, note } = useAdaptiveToday(),
    local = useFocusCheckpoint();
  const [edit, setEdit] = useState<Checkpoint | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const act = async (data: Record<string, unknown>, rev?: number) => {
    setBusy(true);
    try {
      await changeAdaptive(data, rev);
      setEdit(null);
    } catch {
      /* Error stays visible; editor stays intact. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        Compact work checkpoints stay on Unraid. They are not automatically turned into permanent
        memories or Obsidian notes.
      </p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void refreshAdaptive()}>
        Refresh checkpoints
      </Button>
      {local && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act({ op: "checkpoint", session: local })}
        >
          Copy this browser’s saved place to Unraid
        </Button>
      )}
      {!adaptive.checkpoints.length && (
        <p>Save your place during Focus Assist to resume it here on another device.</p>
      )}
      {adaptive.checkpoints.map((c) => (
        <details key={c.id} className="rounded border p-2">
          <summary className="cursor-pointer break-words">{c.session.task}</summary>
          <div className="grid gap-2 pt-2">
            <p>Next: {c.session.step}</p>
            <small>
              {new Date(c.updated).toLocaleString()} ·{" "}
              {projects.find((p) => p.id === c.project)?.name ?? "No project"}
            </small>
            {c.state && <p>{c.state}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!onResume} onClick={() => onResume?.(c.session)}>
                Resume this step
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEdit(c);
                  setRevision(adaptive.revision);
                }}
              >
                Edit checkpoint
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this checkpoint and its saved versions? Your tasks and conversations stay unchanged.",
                    )
                  )
                    void act({ op: "delete", id: c.id });
                }}
              >
                Delete checkpoint
              </Button>
            </div>
            {c.history.length > 0 && (
              <details>
                <summary>Previous versions</summary>
                {c.history.map((h, i) => (
                  <div key={i} className="my-2">
                    <p>{h.session.step}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void act({ op: "restore", id: c.id, index: i })}
                    >
                      Restore version {h.revision}
                    </Button>
                  </div>
                ))}
              </details>
            )}
          </div>
        </details>
      ))}
      {edit && (
        <form
          className="grid gap-2 rounded border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              {
                op: "checkpoint",
                id: edit.id,
                session: edit.session,
                manual: true,
                project: edit.project,
                state: edit.state,
                decisions: edit.decisions,
                blockers: edit.blockers,
                sources: edit.sources,
              },
              revision,
            );
          }}
        >
          <h4>Edit saved work</h4>
          <label className="grid gap-1">
            Project
            <select
              value={edit.project}
              className="rounded border bg-background p-2"
              onChange={(e) => setEdit({ ...edit, project: e.target.value })}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Exact next step
            <input
              required
              maxLength={180}
              value={edit.session.step}
              className="rounded border bg-background p-2"
              onChange={(e) =>
                setEdit({ ...edit, session: { ...edit.session, step: e.target.value } })
              }
            />
          </label>
          {(["state", "decisions", "blockers", "sources"] as const).map((key) => (
            <label className="grid gap-1 capitalize" key={key}>
              {key}
              <textarea
                maxLength={600}
                value={edit[key]}
                className="rounded border bg-background p-2"
                onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
              />
            </label>
          ))}
          <Button disabled={busy}>Save checkpoint changes</Button>
          <Button type="button" variant="outline" onClick={() => setEdit(null)}>
            Cancel editing
          </Button>
        </form>
      )}
      <p role="status" className="text-xs">
        {note}
      </p>
    </div>
  );
}
