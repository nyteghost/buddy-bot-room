export type ServiceRow = { name: string; state: "ok" | "down" | "off"; note?: string };

/** Plain-text report for /status. Never includes addresses or keys, only names and short notes. */
export function servicesReport(rows: ServiceRow[], extra: string[] = []): string {
  const icon = { ok: "✅", down: "⚠", off: "–" } as const;
  const lines = rows.map((r) => `${icon[r.state]} ${r.name}${r.note ? ` — ${r.note}` : r.state === "off" ? " — not set up" : ""}`);
  const down = rows.filter((r) => r.state === "down").length;
  const head = down ? `${down} thing${down === 1 ? "" : "s"} need attention:` : "Everything that is set up looks fine:";
  return [head, ...lines, ...extra].join("\n");
}
