import { Button } from "./ui/button";
import { useAdaptiveToday, changeAdaptive, refreshAdaptive } from "@/lib/adaptive-store";
import { TODAY_SECTIONS, type DayMode } from "@/lib/adaptive-today";
import { agents } from "@/lib/agents";
export function AdaptiveControls() {
  const { adaptive, ready, note } = useAdaptiveToday();
  const patch = (patch: Record<string, unknown>) =>
    void changeAdaptive({ op: "preferences", patch }).catch(() => undefined);
  return (
    <details className="rounded-md border p-3" style={{ order: -28 }}>
      <summary className="cursor-pointer">Customize Today</summary>
      <div className="mt-3 grid gap-3">
        <label>
          Today mode{" "}
          <select
            className="rounded border bg-background p-2"
            aria-label="Today mode"
            value={adaptive.mode}
            disabled={!ready}
            onChange={(e) => patch({ mode: e.target.value as DayMode })}
          >
            <option value="low">Low energy</option>
            <option value="normal">Normal</option>
            <option value="focused">Focused</option>
          </select>
        </label>
        <label>
          Everyday Pal{" "}
          <select
            className="rounded border bg-background p-2"
            aria-label="Everyday Pal"
            value={adaptive.favorite}
            disabled={!ready}
            onChange={(e) => patch({ favorite: e.target.value })}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={adaptive.timeAware}
            disabled={!ready}
            onChange={(e) => patch({ timeAware: e.target.checked })}
          />{" "}
          Show available time before appointments
        </label>
        <p className="text-xs text-muted-foreground">
          Move sections with the buttons. These preferences are saved on Unraid. Refresh to load
          changes made on another device.
        </p>
        {adaptive.sections.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2">
            <label className="min-w-0 flex-1">
              <input
                type="checkbox"
                disabled={!ready}
                checked={!s.hidden}
                onChange={(e) =>
                  patch({
                    sections: adaptive.sections.map((p) =>
                      p.id === s.id ? { ...p, hidden: !e.target.checked } : p,
                    ),
                  })
                }
              />{" "}
              {TODAY_SECTIONS.find(([id]) => id === s.id)![1]}
            </label>
            {([-1, 1] as const).map((delta) => (
              <Button
                key={delta}
                size="sm"
                variant="outline"
                disabled={!ready || i + delta < 0 || i + delta >= adaptive.sections.length}
                aria-label={`${delta < 0 ? "Move up" : "Move down"} ${TODAY_SECTIONS.find(([id]) => id === s.id)![1]}`}
                onClick={() => {
                  const list = [...adaptive.sections];
                  [list[i], list[i + delta]] = [list[i + delta]!, list[i]!];
                  patch({ sections: list });
                }}
              >
                {delta < 0 ? "↑" : "↓"}
              </Button>
            ))}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => void refreshAdaptive()}>
          Refresh saved Today
        </Button>
        <p role="status">{note}</p>
      </div>
    </details>
  );
}
