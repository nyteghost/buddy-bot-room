import type { ReactNode } from "react";
import { useAdaptiveToday, changeAdaptive } from "@/lib/adaptive-store";
import { TODAY_SECTIONS, type TodaySectionId } from "@/lib/adaptive-today";
export function TodaySection({ id, children }: { id: TodaySectionId; children: ReactNode }) {
  const { adaptive } = useAdaptiveToday();
  const pref = adaptive.sections.find((s) => s.id === id)!;
  return (
    <section
      hidden={pref.hidden}
      data-today-section={id}
      style={{ order: adaptive.sections.indexOf(pref) + 1 }}
      className="min-w-0"
    >
      <button
        type="button"
        aria-expanded={!pref.collapsed}
        className="w-full rounded-md border px-3 py-2 text-left text-sm font-semibold"
        onClick={() =>
          void changeAdaptive({
            op: "preferences",
            patch: {
              sections: adaptive.sections.map((s) =>
                s.id === id ? { ...s, collapsed: !s.collapsed } : s,
              ),
            },
          }).catch(() => undefined)
        }
      >
        {pref.collapsed ? "▸" : "▾"} {TODAY_SECTIONS.find(([key]) => key === id)![1]}
      </button>
      <div hidden={pref.collapsed} className="mt-2 min-w-0">
        {children}
      </div>
    </section>
  );
}
