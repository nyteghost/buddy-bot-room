import { useState } from "react";
import { useEngine, setEngine } from "@/lib/engine";
import { useOllamaHealth } from "@/lib/ollama-health-store";
import { modelProblem, serverOllamaTransport, preferredInstalled } from "@/lib/ollama-health";
import { Button } from "./ui/button";
export function OllamaModelSettings() {
  const engine = useEngine(),
    health = useOllamaHealth();
  const [choices, setChoices] = useState<Record<string, string>>({});
  if (!health.reachable || !serverOllamaTransport(engine.ollamaTransport, health)) return null;
  const names = health.models.map((m) => m.name);
  const defaults = ["localChat", "localCode", "localReasoning", "localFast"] as const;
  const rows = [
    ...defaults.map((key) => ({
      key,
      model: String(engine[key as keyof typeof engine] ?? ""),
      pal: false,
    })),
    ...Object.entries(engine.localPals ?? {}).map(([key, model]) => ({ key, model, pal: true })),
  ].filter((row) => row.model && modelProblem(row.model, names));
  return (
    <div
      className="grid min-w-0 gap-2 rounded border p-2 text-xs"
      aria-label="Installed model choices"
    >
      <label className="grid gap-1">
        Default installed model
        <select
          className="min-w-0 rounded border bg-background p-2 text-base"
          value={names.includes(engine.localChat) ? engine.localChat : ""}
          onChange={(e) =>
            setEngine({ localChat: e.target.value, ollamaModel: e.target.value, localAuto: false })
          }
        >
          <option value="" disabled>
            Choose an installed default
          </option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p>Changing the default keeps individual Pal assignments unchanged.</p>
      {rows.map((row) => {
        const id = `${row.pal ? "pal" : "task"}:${row.key}`;
        const choice = choices[id] ?? preferredInstalled(names);
        return (
          <div key={id} className="grid gap-1 rounded border p-2">
            <p>
              {row.pal ? `Pal ${row.key}` : row.key}: {row.model} — Model unavailable. Choose a
              replacement explicitly.
            </p>
            <select
              className="min-w-0 rounded border bg-background p-2 text-base"
              aria-label={`Replacement for ${id}`}
              value={choice}
              onChange={(e) => setChoices((c) => ({ ...c, [id]: e.target.value }))}
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!choice}
              onClick={() =>
                setEngine(
                  row.pal
                    ? { localPals: { ...engine.localPals, [row.key]: choice } }
                    : { [row.key]: choice },
                )
              }
            >
              Use replacement for {row.pal ? `Pal ${row.key}` : row.key}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
