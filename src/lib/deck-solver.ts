// @ts-nocheck -- ported grid algorithm from Deck Builder Pro; covered by src/test/work-tools.test.ts
// Stage deck layout solver. ONE copy, used by the Deck tab (planner.tsx) and the `@deck 24x24x32` chat command,
// so the two can never disagree. Ported from Deck Builder Pro.
import { allocateSingleDeckStages } from "./single-deck-allocation";

export const DECK_INVENTORY = { decks: 72, one: 4, two: 8, three: 8, s5: 1, s6: 2, s7: 5 };


export type Deck = { x: number; y: number; w: number; h: number; isBridge?: boolean };
export type Holder = {
  // x,y,w,h in feet on the stage
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: 1 | 2 | 3;
  decksUsed?: number;
  label: string; // e.g. "H1"
};
export type Bridge = {
  // a single 4×8 deck spanning between two adjacent holders (no holder needed)
  x: number;
  y: number;
  w: number;
  h: number;
  label: string; // e.g. "B1"
  between: [string, string]; // labels of the two holders it bridges
};

export type Result =
  | { ok: true; decks: Deck[]; holders: Holder[]; bridges: Bridge[]; holderError?: string }
  | { ok: false; reason: string };

export const INVENTORY = {
  totalDecks: 72,
  holders: {
    one:   { count: 4, capacity: 1 as const, footprint: "4 ft × 8 ft" },
    two:   { count: 8, capacity: 2 as const, footprint: "8 ft × 8 ft" },
    three: { count: 8, capacity: 3 as const, footprint: "12 ft × 8 ft" },
  },
};
const HOLDER_CAPACITY =
  INVENTORY.holders.one.count * 1 +
  INVENTORY.holders.two.count * 2 +
  INVENTORY.holders.three.count * 3;

/**
 * Ways to cut a run of `r` adjacent decks into holders of 1/2/3 decks,
 * preferred order: fewest 1-deck holders, then fewest holders overall.
 */
export type PlanPrefs = { mostlyThree: boolean; allowTwo: boolean };
export const DEFAULT_PREFS: PlanPrefs = { mostlyThree: false, allowTwo: true };

export function runOptions(r: number, mostlyThree = false): { three: number; two: number; one: number }[] {
  const opts: { three: number; two: number; one: number }[] = [];
  for (let c3 = Math.floor(r / 3); c3 >= 0; c3--) {
    for (let c2 = Math.floor((r - 3 * c3) / 2); c2 >= 0; c2--) {
      const c1 = r - 3 * c3 - 2 * c2;
      if (c1 < 0) continue;
      opts.push({ three: c3, two: c2, one: c1 });
    }
  }
  opts.sort((p, q) =>
    mostlyThree
      ? (p.one - q.one) || (q.three - p.three)
      : (p.one - q.one) || (p.three + p.two + p.one - (q.three + q.two + q.one)),
  );
  return opts;
}

export type Stock = { decks: number; one: number; two: number; three: number; s5?: number; s6?: number; s7?: number };
export const STAIR_TYPES = [
  { key: "s5", label: "5-step stairs" },
  { key: "s6", label: "6-step stairs" },
  { key: "s7", label: "7-step stairs" },
] as const;

export const FULL_STOCK: Stock = {
  decks: INVENTORY.totalDecks,
  one: INVENTORY.holders.one.count,
  two: INVENTORY.holders.two.count,
  three: INVENTORY.holders.three.count,
  s5: 1,
  s6: 2,
  s7: 5,
};

export function planStage(
  widthFt: number,
  lengthFt: number,
  stock: Stock = FULL_STOCK,
  prefs: PlanPrefs = DEFAULT_PREFS,
): Result {
  if ((widthFt === 4 && lengthFt === 8) || (widthFt === 8 && lengthFt === 4)) {
    const allocation = allocateSingleDeckStages(1, stock, prefs.allowTwo);
    const capacity = allocation?.capacities[0];
    if (!capacity) return { ok: false, reason: "No deck or eligible holder remains for this single-deck stage." };
    return { ok: true, decks: [{ x: 0, y: 0, w: widthFt, h: lengthFt }],
      holders: [{ x: 0, y: 0, w: widthFt, h: lengthFt, capacity, decksUsed: 1, label: "H1" }], bridges: [] };
  }
  if (!(widthFt > 0) || !(lengthFt > 0) || !Number.isFinite(widthFt) || !Number.isFinite(lengthFt)) {
    return { ok: false, reason: "Enter a width and length greater than zero." };
  }
  if (widthFt % 4 !== 0 || lengthFt % 4 !== 0) {
    return {
      ok: false,
      reason:
        "Both width and length must be multiples of 4 ft \u2014 4\u00d78 decks can't be cut to fit otherwise.",
    };
  }
  const a = widthFt / 4;
  const b = lengthFt / 4;
  if (a % 2 !== 0 && b % 2 !== 0) {
    return {
      ok: false,
      reason:
        "This size can't be built from whole 4\u00d78 decks: at least one side must be a multiple of 8 ft.",
    };
  }

  // Refuse up front when the stage needs more decks than are available. This gives the real reason (not a
  // misleading "not enough holders"), and stops a huge typed size from building thousands of decks.
  const decksNeeded = (a * b) / 2;
  if (decksNeeded > stock.decks) {
    return { ok: false, reason: `This stage needs ${decksNeeded} decks \u2014 only ${stock.decks} ${stock === FULL_STOCK ? "in the warehouse" : "left for this stage"}.` };
  }

  type Attempt = {
    decks: Deck[];
    holders: Holder[];
    bridges: Bridge[];
    holderError?: string;
    totalHolders: number;
    totalBridges: number;
    singles: number;
    threes: number;
  };

  // A "pattern" decides which decks are carried as bridges instead of sitting
  // on their own holder:
  //  - crossOffset: whole strips (every other one) are bridged, resting on the
  //    holders in the strips either side.
  //  - inOffset: inside a holder strip, every other deck bridges between the
  //    two holders next to it.
  type Pattern = { crossOffset: number | null; inOffset: number | null; inStride: number };

  function buildOrientation(
    orientation: "horizontal" | "vertical",
    pattern: Pattern,
  ): Attempt | null {
    const decks: Deck[] = [];
    const strips: { decks: Deck[]; axis: "y" | "x" }[] = [];

    if (orientation === "horizontal") {
      if (a % 2 !== 0) return null;
      // decks 8\u00d74, strips along Y
      for (let i = 0; i < a; i += 2) {
        const strip: Deck[] = [];
        for (let j = 0; j < b; j++) {
          const d: Deck = { x: i * 4, y: j * 4, w: 8, h: 4 };
          decks.push(d);
          strip.push(d);
        }
        strips.push({ decks: strip, axis: "y" });
      }
    } else {
      if (b % 2 !== 0) return null;
      // decks 4\u00d78, strips along X
      for (let j = 0; j < b; j += 2) {
        const strip: Deck[] = [];
        for (let i = 0; i < a; i++) {
          const d: Deck = { x: i * 4, y: j * 4, w: 4, h: 8 };
          decks.push(d);
          strip.push(d);
        }
        strips.push({ decks: strip, axis: "x" });
      }
    }

    const S = strips.length;
    const K = strips[0].decks.length;

    // ---- decide which cells are bridges ----
    const isBridge: boolean[][] = strips.map(() => new Array(K).fill(false));
    const bridgedStrip: boolean[] = new Array(S).fill(false);
    if (pattern.crossOffset !== null && S >= 3) {
      for (let s = 1; s < S - 1; s++) {
        if ((s - pattern.crossOffset) % 2 === 0) {
          bridgedStrip[s] = true;
          for (let p = 0; p < K; p++) isBridge[s][p] = true;
        }
      }
    }
    if (pattern.inOffset !== null && K >= 3) {
      for (let s = 0; s < S; s++) {
        if (bridgedStrip[s]) continue;
        // a strip that supports a bridged strip must stay solid
        if (bridgedStrip[s - 1] || bridgedStrip[s + 1]) continue;
        for (let p = 1; p < K - 1; p++) {
          if ((p - pattern.inOffset) % pattern.inStride === 0) isBridge[s][p] = true;
        }
      }
    }

    // ---- validate every bridge has support on both sides ----
    const supportedBy: ("cross" | "in")[][] = strips.map(() => new Array(K).fill("cross"));
    for (let s = 0; s < S; s++) {
      for (let p = 0; p < K; p++) {
        if (!isBridge[s][p]) continue;
        const cross =
          s > 0 && s < S - 1 && !isBridge[s - 1][p] && !isBridge[s + 1][p];
        const inline =
          p > 0 && p < K - 1 && !isBridge[s][p - 1] && !isBridge[s][p + 1];
        if (cross) supportedBy[s][p] = "cross";
        else if (inline) supportedBy[s][p] = "in";
        else return null; // unsupported bridge \u2014 pattern invalid
      }
    }

    // ---- lay holders over the remaining runs ----
    const avail = {
      one: stock.one,
      two: prefs.allowTwo ? stock.two : 0,
      three: stock.three,
    };
    type PH = { decks: Deck[]; axis: "x" | "y"; label: string };
    const cellHolder = new Map<string, PH>();
    const phs: PH[] = [];
    let holderError: string | undefined;
    let singles = 0;
    let threes = 0;

    for (let s = 0; s < S; s++) {
      let p = 0;
      while (p < K) {
        if (isBridge[s][p]) { p++; continue; }
        let end = p;
        while (end < K && !isBridge[s][end]) end++;
        const run = strips[s].decks.slice(p, end);
        const chosen = runOptions(run.length, prefs.mostlyThree).find(
          (o) => o.three <= avail.three && o.two <= avail.two && o.one <= avail.one,
        );
        if (!chosen) {
          holderError = `Not enough holders left for a run of ${run.length} decks.`;
          p = end;
          continue;
        }
        avail.three -= chosen.three;
        avail.two -= chosen.two;
        avail.one -= chosen.one;
        singles += chosen.one;
        threes += chosen.three;
        const sizes: (1 | 2 | 3)[] = [];
        for (let i = 0; i < chosen.three; i++) sizes.push(3);
        for (let i = 0; i < chosen.two; i++) sizes.push(2);
        for (let i = 0; i < chosen.one; i++) sizes.push(1);
        let c = 0;
        for (const size of sizes) {
          const group = run.slice(c, c + size);
          const ph: PH = { decks: group, axis: strips[s].axis, label: "" };
          phs.push(ph);
          for (const d of group) cellHolder.set(`${d.x},${d.y}`, ph);
          c += size;
        }
        p = end;
      }
    }

    // ---- materialise holders (labelled top-left first) ----
    const holders: Holder[] = [];
    const phOut = new Map<PH, Holder>();
    const ordered = [...phs].sort((p, q) => {
      const py = Math.min(...p.decks.map((d) => d.y));
      const qy = Math.min(...q.decks.map((d) => d.y));
      const px = Math.min(...p.decks.map((d) => d.x));
      const qx = Math.min(...q.decks.map((d) => d.x));
      return (py - qy) || (px - qx);
    });
    let label = 1;
    for (const ph of ordered) {
      const size = ph.decks.length as 1 | 2 | 3;
      const h: Holder = {
        x: Math.min(...ph.decks.map((d) => d.x)),
        y: Math.min(...ph.decks.map((d) => d.y)),
        w: ph.axis === "x" ? size * 4 : 8,
        h: ph.axis === "y" ? size * 4 : 8,
        capacity: size,
        label: `H${label++}`,
      };
      phOut.set(ph, h);
      holders.push(h);
    }

    // ---- materialise bridges ----
    const bridges: Bridge[] = [];
    for (let s = 0; s < S; s++) {
      for (let p = 0; p < K; p++) {
        if (!isBridge[s][p]) continue;
        const deck = strips[s].decks[p];
        deck.isBridge = true;
        const nbrs =
          supportedBy[s][p] === "cross"
            ? [strips[s - 1].decks[p], strips[s + 1].decks[p]]
            : [strips[s].decks[p - 1], strips[s].decks[p + 1]];
        const l = nbrs[0] && cellHolder.get(`${nbrs[0].x},${nbrs[0].y}`);
        const r = nbrs[1] && cellHolder.get(`${nbrs[1].x},${nbrs[1].y}`);
        const lo = l ? phOut.get(l) : undefined;
        const ro = r ? phOut.get(r) : undefined;
        if (!lo || !ro) return null;
        bridges.push({
          x: deck.x,
          y: deck.y,
          w: deck.w,
          h: deck.h,
          label: "",
          between: [lo.label, ro.label],
        });
      }
    }
    bridges.sort((p, q) => (p.y - q.y) || (p.x - q.x));
    bridges.forEach((br, i) => {
      br.label = `B${i + 1}`;
    });

    return {
      decks,
      holders,
      bridges,
      holderError,
      totalHolders: holders.length,
      totalBridges: bridges.length,
      singles,
      threes,
    };
  }

  // Consider every-fourth deck bridges too: three 4×8 decks can sit on a
  // 3-deck holder, then a bridge spans to the next 3-deck holder. The old
  // alternating-only search split these runs into tiny holder groups.
  const patterns: Pattern[] = [];
  const seenPatterns = new Set<string>();
  for (const crossOffset of [1, 2, null]) {
    for (const stride of [2, 3, 4]) {
      for (let offset = 1; offset <= stride; offset++) {
        const pattern: Pattern = {crossOffset, inOffset: offset, inStride: stride};
        const key = JSON.stringify(pattern);
        if (!seenPatterns.has(key)) { patterns.push(pattern); seenPatterns.add(key); }
      }
    }
    patterns.push({crossOffset, inOffset: null, inStride: 2});
  }

  const attempts: Attempt[] = [];
  for (const o of ["horizontal", "vertical"] as const) {
    for (const pattern of patterns) {
      const r = buildOrientation(o, pattern);
      if (r) attempts.push(r);
    }
  }

  if (attempts.length === 0) {
    return { ok: false, reason: "Could not build this stage with available holders." };
  }
  // Prefer complete, buildable layouts using the fewest holders first.
  // A 3-holder/2-bridge solution is operationally simpler than 5 holders/4 bridges.
  // After fewer holders, favor fewer 1-deck holders and then more useful bridges.
  attempts.sort((p, q) => {
    const pe = p.holderError ? 1 : 0;
    const qe = q.holderError ? 1 : 0;
    if (pe !== qe) return pe - qe;
    if (p.totalHolders !== q.totalHolders) return p.totalHolders - q.totalHolders;
    if (prefs.mostlyThree && p.threes !== q.threes) return q.threes - p.threes;
    if (p.singles !== q.singles) return p.singles - q.singles;
    return q.totalBridges - p.totalBridges;
  });


  const best = attempts[0];
  return {
    ok: true,
    decks: best.decks,
    holders: best.holders,
    bridges: best.bridges,
    holderError: best.holderError,
  };
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
  lines.push("", "Open the **Deck** tab in Work tools to see and adjust the layout.");
  return lines.join("\n");
}
