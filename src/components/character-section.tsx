import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agents } from "@/lib/agents";
import { LIMITS, setOverride, updateOverrides, useOverrides, type MemoryAccess, type Override } from "@/lib/character-overrides";

const MEMORY_LABEL: Record<MemoryAccess, string> = {
  all: "Everything (shared, its own, active project)",
  own: "Only what I tell this pal",
  none: "Nothing (no memories or to-dos)",
};

/** Change one of the eight pals: its name, job, personality, memory access and whether it may read your calendar, mail and tasks.
 *  Applies in the normal theme; the themed casts keep their own characters. Reset puts the built-in pal back. */
export function CharacterSection() {
  const all = useOverrides();
  const [palId, setPalId] = useState<string>(agents[0]?.id ?? "nova");
  const base = agents.find((a) => a.id === palId) ?? agents[0]!;
  const o: Override = all[palId] ?? {};
  const patch = (next: { [K in keyof Override]?: Override[K] | undefined }) =>
    updateOverrides((cur) => setOverride(cur, palId, Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Override));
  const field = (k: "name" | "role" | "tone", v: string) => patch({ ...o, [k]: v.trim() ? v : undefined });
  return (
    <section>
      <h3>Characters <span>rename and reshape a pal</span></h3>
      <label className="grid gap-1">
        <select aria-label="Which pal to change" className="h-9 rounded-md border border-input bg-background px-2" value={palId} onChange={(e) => setPalId(e.target.value)}>
          {agents.map((a) => <option key={a.id} value={a.id}>{all[a.id]?.name ?? a.name}{all[a.id] ? " ✎" : ""}</option>)}
        </select>
      </label>
      <div className="grid gap-2 mt-2">
        <label className="grid gap-1 text-xs">Name
          <Input aria-label="Pal name" maxLength={LIMITS.name} placeholder={base.name} value={o.name ?? ""} onChange={(e) => field("name", e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs">Job
          <Input aria-label="Pal job" maxLength={LIMITS.role} placeholder={base.role} value={o.role ?? ""} onChange={(e) => field("role", e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs">Personality
          <textarea aria-label="Pal personality" className="pal-note" maxLength={LIMITS.tone} placeholder={base.tone} value={o.tone ?? ""} onChange={(e) => field("tone", e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs">What this pal remembers
          <select aria-label="Memory access" className="h-9 rounded-md border border-input bg-background px-2" value={o.memory ?? "all"} onChange={(e) => patch({ ...o, memory: e.target.value as MemoryAccess })}>
            {(Object.keys(MEMORY_LABEL) as MemoryAccess[]).map((k) => <option key={k} value={k}>{MEMORY_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={o.realData !== false} onChange={(e) => patch({ ...o, realData: e.target.checked ? undefined : false })} />
          May see my calendar, mail subjects and tasks when I ask
        </label>
      </div>
      <div className="docs-actions">
        <Button type="button" size="sm" variant="outline" disabled={!all[palId]} onClick={() => updateOverrides((cur) => setOverride(cur, palId, null))}><RotateCcw size={13} /> Reset {base.name}</Button>
      </div>
      <p className="docs-note">Applies in the normal theme; themed casts keep their own characters. Art and room seats stay the same. Names in older messages and the pixel room update after a reload.</p>
    </section>
  );
}
