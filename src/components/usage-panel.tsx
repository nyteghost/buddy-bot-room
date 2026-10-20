import { Button } from "@/components/ui/button";
import { setEngine, useEngine } from "@/lib/engine";
import { fmtUsd, summarize } from "@/lib/usage";
import { clearUsage, useUsage } from "@/lib/usage-store";

const NAMES: Record<string, string> = { groq: "Groq", gemini: "Gemini", openrouter: "OpenRouter", nvidia: "NVIDIA NIM", anthropic: "Claude (paid)", custom: "Custom provider", "ollama-server": "Local AI" };
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/** A one-line meter for the corner of a chat window: replies today and estimated spend this month. */
export function UsageMeter() {
  const engine = useEngine();
  const entries = useUsage();
  const now = new Date();
  const { usd } = summarize(entries, now, { inPerM: engine.customPriceIn, outPerM: engine.customPriceOut });
  const day = now.toDateString();
  const today = entries.filter((e) => new Date(e.t).toDateString() === day).length;
  const capped = engine.spendCapUsd > 0 && usd >= engine.spendCapUsd;
  return <span className="usage-meter" title="Estimated from message length, kept in this browser. Free providers cost nothing; paid ones count toward your monthly cap.">{today} repl{today === 1 ? "y" : "ies"} today · {usd > 0 ? `about ${fmtUsd(usd)}` : "$0"} this month{capped ? " · CAP REACHED" : engine.spendCapUsd > 0 ? ` of $${engine.spendCapUsd}` : ""}</span>;
}

/** Estimated usage and spend this month, with an optional cap that switches paid providers off. */
export function UsagePanel() {
  const engine = useEngine();
  const entries = useUsage();
  const custom = { inPerM: engine.customPriceIn, outPerM: engine.customPriceOut };
  const { rows, usd } = summarize(entries, new Date(), custom);
  const capped = engine.spendCapUsd > 0 && usd >= engine.spendCapUsd;
  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Usage and spend this month · about {fmtUsd(usd)}{capped ? " · CAP REACHED" : ""}</summary>
      <div className="mt-2 grid gap-2">
        <p className="text-muted-foreground">Estimates from message length (about 4 characters per token), kept in this browser. Providers' own dashboards are the real bill.</p>
        {rows.length === 0 && <p className="text-muted-foreground">Nothing yet this month.</p>}
        {rows.map((r) => (
          <div key={r.kind} className="flex justify-between gap-2"><span>{NAMES[r.kind] ?? r.kind}</span><span className="text-muted-foreground">{r.calls} replies · {tok(r.inTok)} in / {tok(r.outTok)} out{r.usd > 0 ? ` · ${fmtUsd(r.usd)}` : ""}</span></div>
        ))}
        <label className="grid gap-1">
          <span className="font-medium">Monthly cap for paid providers (USD, 0 = none)</span>
          <input className="rounded-md border bg-background px-2 py-2" inputMode="decimal" value={engine.spendCapUsd || ""} placeholder="e.g. 5" onChange={(e) => setEngine({ spendCapUsd: num(e.target.value) })} />
          <span className="text-xs text-muted-foreground">When the estimate reaches the cap, Claude and any custom provider marked as paid are skipped until next month. Free keys keep working.</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1"><span className="text-xs">Custom provider: $ per 1M input tokens</span><input className="rounded-md border bg-background px-2 py-2" inputMode="decimal" value={engine.customPriceIn || ""} onChange={(e) => setEngine({ customPriceIn: num(e.target.value) })} /></label>
          <label className="grid gap-1"><span className="text-xs">$ per 1M output tokens</span><input className="rounded-md border bg-background px-2 py-2" inputMode="decimal" value={engine.customPriceOut || ""} onChange={(e) => setEngine({ customPriceOut: num(e.target.value) })} /></label>
        </div>
        <Button type="button" size="sm" variant="ghost" className="h-11 justify-start sm:h-8" onClick={() => { if (window.confirm("Clear the usage log?")) clearUsage(); }}>Clear usage log</Button>
      </div>
    </details>
  );
}
