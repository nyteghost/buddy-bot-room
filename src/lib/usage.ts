/** Rough token and cost estimates. Providers don't report usage to the browser, so these are estimates (about 4 characters per token). */
export type UsageEntry = { t: number; kind: string; model: string; inTok: number; outTok: number };
export type Prices = Record<string, [number, number]>; // USD per million tokens: [input, output]

/** Known Claude prices. Anything else is free, local, or priced by the user. */
export const CLAUDE_PRICES: Prices = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

export const estimateTokens = (chars: number): number => Math.max(1, Math.ceil(chars / 4));
export const monthKey = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export type CustomPrice = { inPerM: number; outPerM: number };

export function costUsd(e: UsageEntry, custom?: CustomPrice): number {
  const p = e.kind === "anthropic" ? CLAUDE_PRICES[e.model] : e.kind === "custom" && custom ? ([custom.inPerM, custom.outPerM] as [number, number]) : undefined;
  return p ? (e.inTok * p[0] + e.outTok * p[1]) / 1e6 : 0;
}

export type Summary = { kind: string; calls: number; inTok: number; outTok: number; usd: number };

/** Usage in the month containing `now`, grouped by provider, plus the total estimated spend. */
export function summarize(entries: UsageEntry[], now: Date, custom?: CustomPrice): { rows: Summary[]; usd: number } {
  const month = monthKey(now);
  const by = new Map<string, Summary>();
  for (const e of entries) {
    if (monthKey(new Date(e.t)) !== month) continue;
    const row = by.get(e.kind) ?? { kind: e.kind, calls: 0, inTok: 0, outTok: 0, usd: 0 };
    row.calls++; row.inTok += e.inTok; row.outTok += e.outTok; row.usd += costUsd(e, custom);
    by.set(e.kind, row);
  }
  const rows = [...by.values()].sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  return { rows, usd: rows.reduce((n, r) => n + r.usd, 0) };
}

/** True once estimated spend this month has reached the cap (0 or less means no cap). */
export const overCap = (entries: UsageEntry[], now: Date, capUsd: number, custom?: CustomPrice): boolean =>
  capUsd > 0 && summarize(entries, now, custom).usd >= capUsd;

/** Keeps the log small: this month and last, newest 3000. */
export function trim(entries: UsageEntry[], now: Date): UsageEntry[] {
  const cutoff = now.getTime() - 62 * 24 * 3600 * 1000;
  return entries.filter((e) => e.t >= cutoff).slice(-3000);
}

export const fmtUsd = (n: number): string => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
