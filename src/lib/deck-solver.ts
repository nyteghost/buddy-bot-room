// @ts-nocheck -- ported grid algorithm from Deck Builder Pro; covered by src/test/work-tools.test.ts
// Ported from Deck Builder Pro: 4x8 deck, holder and bridge planner.
type Deck = { x: number; y: number; w: number; h: number; isBridge?: boolean };
type Holder = { x: number; y: number; w: number; h: number; capacity: 1 | 2 | 3; label: string };
type Bridge = { x: number; y: number; w: number; h: number; label: string; between: [string, string] };
export type DeckResult =
  | { ok: true; decks: Deck[]; holders: Holder[]; bridges: Bridge[]; holderError?: string }
  | { ok: false; reason: string };

export const DECK_INVENTORY = { decks: 72, one: 4, two: 8, three: 8, s5: 1, s6: 2, s7: 5 };
export const DECK_BUILDER_URL = "https://deck-builder-pro.lovable.app";

function runOptions(r: number) {
  const opts: { three: number; two: number; one: number }[] = [];
  for (let c3 = Math.floor(r / 3); c3 >= 0; c3--)
    for (let c2 = Math.floor((r - 3 * c3) / 2); c2 >= 0; c2--) opts.push({ three: c3, two: c2, one: r - 3 * c3 - 2 * c2 });
  return opts.sort((p, q) => p.one - q.one || p.three + p.two + p.one - (q.three + q.two + q.one));
}

export function planStage(widthFt: number, lengthFt: number): DeckResult {
  const stock = DECK_INVENTORY;
  if ((widthFt === 4 && lengthFt === 8) || (widthFt === 8 && lengthFt === 4))
    return { ok: true, decks: [{ x: 0, y: 0, w: widthFt, h: lengthFt }], holders: [{ x: 0, y: 0, w: widthFt, h: lengthFt, capacity: 1, label: "H1" }], bridges: [] };
  if (widthFt <= 0 || lengthFt <= 0) return { ok: false, reason: "Enter a width and length greater than zero." };
  if (widthFt % 4 || lengthFt % 4) return { ok: false, reason: "Width and length must be multiples of 4 ft — 4×8 decks can't be cut to fit otherwise." };
  const a = widthFt / 4, b = lengthFt / 4;
  if (a % 2 && b % 2) return { ok: false, reason: "At least one side must be a multiple of 8 ft." };
  if (a * b / 2 > stock.decks) return { ok: false, reason: `That needs ${a * b / 2} decks — only ${stock.decks} in the warehouse.` };

  type Attempt = { decks: Deck[]; holders: Holder[]; bridges: Bridge[]; holderError?: string; singles: number };
  type Pattern = { crossOffset: number | null; inOffset: number | null };

  function build(orientation: "horizontal" | "vertical", pattern: Pattern): Attempt | null {
    const decks: Deck[] = [];
    const strips: { decks: Deck[]; axis: "x" | "y" }[] = [];
    if (orientation === "horizontal") {
      if (a % 2) return null;
      for (let i = 0; i < a; i += 2) {
        const strip: Deck[] = [];
        for (let j = 0; j < b; j++) { const d = { x: i * 4, y: j * 4, w: 8, h: 4 }; decks.push(d); strip.push(d); }
        strips.push({ decks: strip, axis: "y" });
      }
    } else {
      if (b % 2) return null;
      for (let j = 0; j < b; j += 2) {
        const strip: Deck[] = [];
        for (let i = 0; i < a; i++) { const d = { x: i * 4, y: j * 4, w: 4, h: 8 }; decks.push(d); strip.push(d); }
        strips.push({ decks: strip, axis: "x" });
      }
    }
    const S = strips.length, K = strips[0].decks.length;
    const isBridge = strips.map(() => new Array<boolean>(K).fill(false));
    const bridged = new Array<boolean>(S).fill(false);
    if (pattern.crossOffset !== null && S >= 3)
      for (let s = 1; s < S - 1; s++) if ((s - pattern.crossOffset) % 2 === 0) { bridged[s] = true; isBridge[s].fill(true); }
    if (pattern.inOffset !== null && K >= 3)
      for (let s = 0; s < S; s++) {
        if (bridged[s] || bridged[s - 1] || bridged[s + 1]) continue;
        for (let p = 1; p < K - 1; p++) if ((p - pattern.inOffset) % 2 === 0) isBridge[s][p] = true;
      }
    const support: ("cross" | "in")[][] = strips.map(() => new Array(K).fill("cross"));
    for (let s = 0; s < S; s++)
      for (let p = 0; p < K; p++) {
        if (!isBridge[s][p]) continue;
        if (s > 0 && s < S - 1 && !isBridge[s - 1][p] && !isBridge[s + 1][p]) support[s][p] = "cross";
        else if (p > 0 && p < K - 1 && !isBridge[s][p - 1] && !isBridge[s][p + 1]) support[s][p] = "in";
        else return null;
      }
    const avail = { one: stock.one, two: stock.two, three: stock.three };
    type PH = { decks: Deck[]; axis: "x" | "y" };
    const cell = new Map<string, PH>();
    const phs: PH[] = [];
    let holderError: string | undefined;
    let singles = 0;
    for (let s = 0; s < S; s++) {
      let p = 0;
      while (p < K) {
        if (isBridge[s][p]) { p++; continue; }
        let end = p;
        while (end < K && !isBridge[s][end]) end++;
        const run = strips[s].decks.slice(p, end);
        const c = runOptions(run.length).find((o) => o.three <= avail.three && o.two <= avail.two && o.one <= avail.one);
        if (!c) { holderError = `Not enough holders left for a run of ${run.length} decks.`; p = end; continue; }
        avail.three -= c.three; avail.two -= c.two; avail.one -= c.one; singles += c.one;
        const sizes = [...Array(c.three).fill(3), ...Array(c.two).fill(2), ...Array(c.one).fill(1)] as number[];
        let i = 0;
        for (const size of sizes) {
          const ph = { decks: run.slice(i, i + size), axis: strips[s].axis };
          phs.push(ph);
          for (const d of ph.decks) cell.set(`${d.x},${d.y}`, ph);
          i += size;
        }
        p = end;
      }
    }
    const out = new Map<PH, Holder>();
    const holders: Holder[] = [];
    let n = 1;
    for (const ph of [...phs].sort((p, q) => Math.min(...p.decks.map((d) => d.y)) - Math.min(...q.decks.map((d) => d.y)) || Math.min(...p.decks.map((d) => d.x)) - Math.min(...q.decks.map((d) => d.x)))) {
      const size = ph.decks.length as 1 | 2 | 3;
      const h: Holder = { x: Math.min(...ph.decks.map((d) => d.x)), y: Math.min(...ph.decks.map((d) => d.y)), w: ph.axis === "x" ? size * 4 : 8, h: ph.axis === "y" ? size * 4 : 8, capacity: size, label: `H${n++}` };
      out.set(ph, h); holders.push(h);
    }
    const bridges: Bridge[] = [];
    for (let s = 0; s < S; s++)
      for (let p = 0; p < K; p++) {
        if (!isBridge[s][p]) continue;
        const deck = strips[s].decks[p];
        deck.isBridge = true;
        const nb = support[s][p] === "cross" ? [strips[s - 1].decks[p], strips[s + 1].decks[p]] : [strips[s].decks[p - 1], strips[s].decks[p + 1]];
        const l = out.get(cell.get(`${nb[0].x},${nb[0].y}`)!), r = out.get(cell.get(`${nb[1].x},${nb[1].y}`)!);
        if (!l || !r) return null;
        bridges.push({ ...deck, label: "", between: [l.label, r.label] });
      }
    bridges.sort((p, q) => p.y - q.y || p.x - q.x).forEach((br, i) => (br.label = `B${i + 1}`));
    return { decks, holders, bridges, holderError, singles };
  }

  const attempts: Attempt[] = [];
  for (const o of ["horizontal", "vertical"] as const)
    for (const crossOffset of [1, 2, null]) for (const inOffset of [1, 2, null]) {
      const r = build(o, { crossOffset, inOffset });
      if (r) attempts.push(r);
    }
  if (!attempts.length) return { ok: false, reason: "Could not build this stage with available holders." };
  attempts.sort((p, q) => (p.holderError ? 1 : 0) - (q.holderError ? 1 : 0) || q.bridges.length - p.bridges.length || p.singles - q.singles || p.holders.length - q.holders.length);
  const { decks, holders, bridges, holderError } = attempts[0];
  return { ok: true, decks, holders, bridges, holderError };
}

export function stairsFor(heightIn: number) {
  if (heightIn >= 42) return "7-step";
  if (heightIn >= 36) return "6-step";
  return "5-step";
}

/** Parses "@deck 24x24x32" (width x length x height in inches). */
export function parseDeckCommand(text: string) {
  const m = text.trim().match(/^@(?:deck|stage|staging)\b[\s,]*(\d+)\s*[x×]\s*(\d+)(?:\s*[x×]\s*(\d+))?/i);
  if (!m) return null;
  return { width: Number(m[1]), length: Number(m[2]), height: m[3] ? Number(m[3]) : 32 };
}

export function deckReply(text: string): string | null {
  const cmd = parseDeckCommand(text);
  if (!cmd) {
    return /^@(deck|stage|staging)\b/i.test(text.trim()) ? "Give me a size like `@deck 24x24x32` (width × length in feet × height in inches)." : null;
  }
  const { width, length, height } = cmd;
  if (height < 32 || height > 44) return `Height must be 32"–44" (legs range). You asked for ${height}".`;
  const r = planStage(width, length);
  if (!r.ok) return `**${width}×${length} ft stage:** ${r.reason}`;
  const count = (c: number) => r.holders.filter((h) => h.capacity === c).length;
  const decks = r.decks.length;
  const lines = [
    `**Stage ${width}×${length} ft @ ${height}"** — ${width * length} sq ft`,
    "",
    `- **Decks (4×8):** ${decks} of ${DECK_INVENTORY.decks} in stock (${decks - r.bridges.length} on holders, ${r.bridges.length} bridges)`,
    `- **3-deck holders:** ${count(3)} of ${DECK_INVENTORY.three}`,
    `- **2-deck holders:** ${count(2)} of ${DECK_INVENTORY.two}`,
    `- **1-deck holders:** ${count(1)} of ${DECK_INVENTORY.one}`,
    `- **Legs:** set to ${height}"`,
    `- **Stairs:** ${stairsFor(height)} suggested`,
  ];
  if (r.holderError) lines.push("", `⚠️ ${r.holderError}`);
  lines.push("", `[Open Deck Builder Pro](${DECK_BUILDER_URL}) to see the layout.`);
  return lines.join("\n");
}
