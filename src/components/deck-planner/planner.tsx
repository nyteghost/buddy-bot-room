// @ts-nocheck -- ported unchanged from the Deck Builder Pro repo, which type-checks under looser settings than this app.
import { z } from "zod";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StageLayout, type LayoutStage } from "@/components/deck-planner/stage-layout";
import { allocateSingleDeckStages } from "@/lib/single-deck-allocation";
import { INVENTORY, FULL_STOCK, STAIR_TYPES, DEFAULT_PREFS, planStage, type Deck, type Holder, type Bridge, type Result, type Stock, type PlanPrefs } from "@/lib/deck-solver";



const HOLDER_COLORS: Record<1 | 2 | 3, string> = {
  1: "rgba(59, 130, 246, 0.85)",   // blue
  2: "rgba(16, 185, 129, 0.85)",   // green
  3: "rgba(234, 88, 12, 0.85)",    // orange
};
const BRIDGE_COLOR = "rgba(234, 179, 8, 0.95)"; // yellow
const MIN_HEIGHT_IN = 32;
const MAX_HEIGHT_IN = 44;
const HEIGHT_PRESETS = [32, 34, 36, 38, 40, 42, 44];

// ---------- persisted stage settings (survive rebuilds, remounts, reloads) ----------
const STAGE_STORE_KEY = "stage-planner:stages";
const APP_STORE_KEY = "stage-planner:app";
const stageQuantitySchema = z.number().int().min(1).max(INVENTORY.totalDecks);

type SavedStage = {
  quantity?: number;
  width?: number;
  length?: number;
  heightIn?: number;
  heightText?: string;
  stageName?: string;
  mostlyThree?: boolean;
  allowTwo?: boolean;
};
type SavedApp = {
  stageCount?: number;
  showSecond?: boolean;
  showThird?: boolean;
  showFourth?: boolean;
  showFifth?: boolean;
  eventName?: string;
};

/** Prints just the planner: a body class lets the print styles hide the rest of the app while the browser prints. */
function printDeck() {
  document.body.classList.add("printing-deck");
  const done = () => { document.body.classList.remove("printing-deck"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — ignore
  }
}
function writeSavedStage(stageId: string, s: SavedStage) {
  const all = readStored<Record<string, SavedStage>>(STAGE_STORE_KEY, {});
  all[stageId] = s;
  writeStored(STAGE_STORE_KEY, all);
}


// ---------------------------------------------------------------------------
// Manual placement
// ---------------------------------------------------------------------------

type ManualPiece = {
  id: string;
  kind: "holder" | "bridge";
  capacity: 1 | 2 | 3;
  axis: "x" | "y"; // "x": decks 4' wide × 8' deep, run left→right. "y": decks 8'×4', run top→bottom
  x: number;
  y: number;
  w: number;
  h: number;
};

type Tool = { kind: "holder" | "bridge" | "erase"; capacity: 1 | 2 | 3 };

function pieceFootprint(kind: "holder" | "bridge", capacity: 1 | 2 | 3, axis: "x" | "y") {
  const n = kind === "bridge" ? 1 : capacity;
  return axis === "x" ? { w: n * 4, h: 8 } : { w: 8, h: n * 4 };
}

function snapOrigin(fx: number, fy: number, axis: "x" | "y") {
  return axis === "x"
    ? { x: Math.floor(fx / 4) * 4, y: Math.floor(fy / 8) * 8 }
    : { x: Math.floor(fx / 8) * 8, y: Math.floor(fy / 4) * 4 };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function holderAtPoint(pieces: ManualPiece[], px: number, py: number) {
  return pieces.find(
    (p) => p.kind === "holder" && px > p.x && px < p.x + p.w && py > p.y && py < p.y + p.h,
  );
}

function pieceAtPoint(pieces: ManualPiece[], px: number, py: number) {
  return [...pieces]
    .reverse()
    .find((p) => px > p.x && px < p.x + p.w && py > p.y && py < p.y + p.h);
}

/** The four neighbour probe points around a piece (left, right, above, below). */
function neighbourPoints(p: { x: number; y: number; w: number; h: number }) {
  return {
    left: [p.x - 2, p.y + p.h / 2] as const,
    right: [p.x + p.w + 2, p.y + p.h / 2] as const,
    up: [p.x + p.w / 2, p.y - 2] as const,
    down: [p.x + p.w / 2, p.y + p.h + 2] as const,
  };
}

function bridgeSupport(pieces: ManualPiece[], br: { x: number; y: number; w: number; h: number }) {
  const n = neighbourPoints(br);
  const l = holderAtPoint(pieces, ...n.left);
  const r = holderAtPoint(pieces, ...n.right);
  if (l && r) return [l, r] as const;
  const u = holderAtPoint(pieces, ...n.up);
  const d = holderAtPoint(pieces, ...n.down);
  if (u && d) return [u, d] as const;
  return null;
}

/** Recreate editable pieces from an automatic plan so manual mode starts there. */
function piecesFromResult(res: Result): ManualPiece[] {
  if (!res.ok) return [];
  let n = 0;
  const out: ManualPiece[] = [];
  for (const h of res.holders) {
    const deck = res.decks.find((d) => d.x === h.x && d.y === h.y);
    const axis: "x" | "y" = deck && deck.w === 8 ? "y" : "x";
    out.push({ id: `m${n++}`, kind: "holder", capacity: h.capacity, axis, x: h.x, y: h.y, w: h.w, h: h.h });
  }
  for (const b of res.bridges) {
    out.push({
      id: `m${n++}`,
      kind: "bridge",
      capacity: 1,
      axis: b.w === 8 ? "y" : "x",
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    });
  }
  return out;
}

/** Turn manually placed pieces into the same shape the auto planner returns. */
function manualResult(pieces: ManualPiece[], widthFt: number, lengthFt: number): Result {
  if (widthFt <= 0 || lengthFt <= 0) {
    return { ok: false, reason: "Enter a width and length greater than zero." };
  }

  const holderPieces = [...pieces.filter((p) => p.kind === "holder")].sort(
    (p, q) => p.y - q.y || p.x - q.x,
  );
  const labels = new Map<string, Holder>();
  const holders: Holder[] = [];
  holderPieces.forEach((p, i) => {
    const h: Holder = {
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      capacity: p.capacity,
      label: `H${i + 1}`,
    };
    labels.set(p.id, h);
    holders.push(h);
  });

  const decks: Deck[] = [];
  for (const p of holderPieces) {
    for (let i = 0; i < p.capacity; i++) {
      decks.push(
        p.axis === "x"
          ? { x: p.x + i * 4, y: p.y, w: 4, h: 8 }
          : { x: p.x, y: p.y + i * 4, w: 8, h: 4 },
      );
    }
  }

  const warnings: string[] = [];
  const bridges: Bridge[] = [];
  const bridgePieces = [...pieces.filter((p) => p.kind === "bridge")].sort(
    (p, q) => p.y - q.y || p.x - q.x,
  );
  bridgePieces.forEach((p, i) => {
    const label = `B${i + 1}`;
    const support = bridgeSupport(pieces, p);
    const between: [string, string] = support
      ? [labels.get(support[0].id)?.label ?? "?", labels.get(support[1].id)?.label ?? "?"]
      : ["?", "?"];
    if (!support) warnings.push(`${label} has no holder on both sides — it is unsupported.`);
    bridges.push({ x: p.x, y: p.y, w: p.w, h: p.h, label, between });
    decks.push({ x: p.x, y: p.y, w: p.w, h: p.h, isBridge: true });
  });

  const totalSlots = Math.round((widthFt * lengthFt) / 32);
  const coveredArea = decks.length * 32;
  if (coveredArea < widthFt * lengthFt) {
    warnings.push(
      `${widthFt * lengthFt - coveredArea} sq ft still empty (${decks.length} of ${totalSlots} deck spaces placed).`,
    );
  }


  return {
    ok: true,
    decks,
    holders,
    bridges,
    holderError: warnings.length ? warnings.join(" ") : undefined,
  };
}


function StagePanel({
  stageId,
  title,
  defaultWidth,
  defaultLength,
  stock = FULL_STOCK,
  onUsage,
  onLayoutChange,
  rebuildKey = 0,
}: {
  stageId: string;
  title: string;
  defaultWidth: number;
  defaultLength: number;
  labelPrefix?: string;
  stock?: Stock;
  onUsage?: (u: Stock) => void;
  onLayoutChange?: (stage: LayoutStage) => void;
  rebuildKey?: number;
}) {
  const [width, setWidth] = useState(defaultWidth);
  const [length, setLength] = useState(defaultLength);
  const [heightIn, setHeightIn] = useState(MIN_HEIGHT_IN);
  const [heightText, setHeightText] = useState(String(MIN_HEIGHT_IN));
  const [stageName, setStageName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [quantityText, setQuantityText] = useState("1");
  const [quantityError, setQuantityError] = useState("");
  const isSingleDeckStage = (width === 4 && length === 8) || (width === 8 && length === 4);
  const stageQuantity = isSingleDeckStage ? quantity : 1;
  const [looseBridgesRaw, setLooseBridges] = useState(0);
  const looseBridges = isSingleDeckStage ? looseBridgesRaw : 0;

  const displayTitle = stageName.trim() || title;


  // ---- manual placement state ----
  const [manual, setManual] = useState(false);
  const [pieces, setPieces] = useState<ManualPiece[]>([]);
  const [tool, setTool] = useState<Tool>({ kind: "holder", capacity: 3 });
  const [axis, setAxis] = useState<"x" | "y">("x");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const nextId = useRef(0);

  const [mostlyThree, setMostlyThree] = useState(false);
  const [allowTwo, setAllowTwo] = useState(true);
  const [planNonce, setPlanNonce] = useState(0);
  const autoResult = useMemo(
    () => planStage(width, length, stock, { mostlyThree, allowTwo }),
    // planNonce forces a full re-plan when "Rebuild all stages" is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, length, stock, mostlyThree, allowTwo, planNonce],
  );
  const singleResult = useMemo(
    () => (manual ? manualResult(pieces, width, length) : autoResult),
    [manual, pieces, width, length, autoResult],
  );

  const singleAllocation = useMemo(() => isSingleDeckStage
    ? allocateSingleDeckStages(stageQuantity, stock, allowTwo) : null,
    [isSingleDeckStage, stageQuantity, stock, allowTwo]);
  const result = useMemo<Result>(() => {
    if (!isSingleDeckStage) return singleResult;
    if (!singleAllocation) {
      return { ok: false, reason: `These ${stageQuantity} stages need ${stageQuantity} decks and one holder per stage. Only ${stock.decks} decks, ${stock.one} single-deck holders, ${allowTwo ? stock.two : 0} eligible 2-deck holders and ${stock.three} 3-deck holders remain.` };
    }
    if (singleResult.ok && singleResult.decks.length === 1 && singleResult.holders.length === 1) {
      return { ...singleResult, holders: singleResult.holders.map(h => ({ ...h,
        capacity: singleAllocation.capacities[0] ?? h.capacity, decksUsed: 1 })) };
    }
    return singleResult;
  }, [isSingleDeckStage, stageQuantity, stock, allowTwo, singleAllocation, singleResult]);

  // Keep stage settings (width/length/height/name/etc.) saved so nothing wipes
  // them — not the rebuild button, a page reload, or a component remount.
  const skipSave = useRef(true);
  useEffect(() => {
    const s = readStored<Record<string, SavedStage>>(STAGE_STORE_KEY, {})[stageId];
    if (s) {
      const savedQuantity = stageQuantitySchema.safeParse(s.quantity);
      if (savedQuantity.success) {
        setQuantity(savedQuantity.data);
        setQuantityText(String(savedQuantity.data));
      }
      if (typeof s.width === "number" && s.width > 0) setWidth(s.width);
      if (typeof s.length === "number" && s.length > 0) setLength(s.length);
      if (typeof s.heightIn === "number") setHeightIn(s.heightIn);
      if (typeof s.heightText === "string" && s.heightText !== "") setHeightText(s.heightText);
      if (typeof s.stageName === "string") setStageName(s.stageName);
      if (typeof s.mostlyThree === "boolean") setMostlyThree(s.mostlyThree);
      if (typeof s.allowTwo === "boolean") setAllowTwo(s.allowTwo);
    }
    skipSave.current = true;
  }, [stageId]);
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    writeSavedStage(stageId, { width, length, heightIn, heightText, stageName, quantity, mostlyThree, allowTwo });
  }, [stageId, width, length, heightIn, heightText, stageName, quantity, mostlyThree, allowTwo]);

  const loadAutoPlan = () => {
    const seeded = piecesFromResult(autoResult);
    nextId.current = seeded.length;
    setPieces(seeded.map((p, i) => ({ ...p, id: `p${i}` })));
    setPlaceError(null);
  };

  const enterManual = () => {
    loadAutoPlan();
    setManual(true);
  };

  // Rebuild from the auto plan when the global "rebuild all" button is pressed.
  const firstRebuild = useRef(true);
  useEffect(() => {
    if (firstRebuild.current) {
      firstRebuild.current = false;
      return;
    }
    // Erase everything on this stage (hand-placed and auto pieces) and re-plan.
    setManual(false);
    setPieces([]);
    setPlaceError(null);
    setDrag(null);
    setPlanNonce((n) => n + 1);
  }, [rebuildKey]);

  const [drag, setDrag] = useState<{
    id: string;
    sx: number;
    sy: number;
    nx: number;
    ny: number;
    moved: boolean;
    cx?: number;
    cy?: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const toFeet = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { fx: (e.clientX - rect.left) / scale, fy: (e.clientY - rect.top) / scale };
  };

  const dragTarget = (p: ManualPiece, d: { sx: number; sy: number }, fx: number, fy: number) => {
    const stepX = p.axis === "x" ? 4 : 8;
    const stepY = p.axis === "x" ? 8 : 4;
    return {
      nx: p.x + Math.round((fx - d.sx) / stepX) * stepX,
      ny: p.y + Math.round((fy - d.sy) / stepY) * stepY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!manual || tool.kind === "erase") return;
    const { fx, fy } = toFeet(e);
    const hit = pieceAtPoint(pieces, fx, fy);
    if (!hit) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id: "__new", sx: fx, sy: fy, nx: 0, ny: 0, moved: false, cx: fx, cy: fy });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: hit.id, sx: fx, sy: fy, nx: hit.x, ny: hit.y, moved: false });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const { fx, fy } = toFeet(e);
    if (drag.id === "__new") {
      const moved = drag.moved || Math.hypot(fx - drag.sx, fy - drag.sy) > 0.5;
      setDrag({ ...drag, cx: fx, cy: fy, moved });
      return;
    }
    const p = pieces.find((q) => q.id === drag.id);
    if (!p) return;
    const { nx, ny } = dragTarget(p, drag, fx, fy);
    const moved = drag.moved || Math.hypot(fx - drag.sx, fy - drag.sy) > 0.5;
    if (nx !== drag.nx || ny !== drag.ny || moved !== drag.moved)
      setDrag({ ...drag, nx, ny, moved });
  };

  const handlePointerUp = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) return;
    suppressClick.current = true;
    if (d.id === "__new") {
      placeAt(d.cx ?? d.sx, d.cy ?? d.sy);
      return;
    }
    const p = pieces.find((q) => q.id === d.id);
    if (!p || (p.x === d.nx && p.y === d.ny)) return;
    const moved = { ...p, x: d.nx, y: d.ny };
    if (moved.x < 0 || moved.y < 0 || moved.x + moved.w > width || moved.y + moved.h > length) {
      setPlaceError("That piece would hang off the stage.");
      return;
    }
    const others = pieces.filter((q) => q.id !== p.id);
    if (others.some((q) => rectsOverlap(q, moved))) {
      setPlaceError("That space is already taken.");
      return;
    }
    const next = [...others, moved];
    if (moved.kind === "bridge" && !bridgeSupport(next, moved)) {
      setPlaceError("A bridge needs a holder on both sides of it.");
      return;
    }
    if (next.some((q) => q.kind === "bridge" && !bridgeSupport(next, q))) {
      setPlaceError("Moving that holder would leave a bridge without support.");
      return;
    }
    setPieces(next);
    setPlaceError(null);
  };

  const dragGhost = (() => {
    if (!drag || !drag.moved) return null;
    if (drag.id === "__new") {
      if (tool.kind === "erase") return null;
      const { w, h } = pieceFootprint(tool.kind, tool.capacity, axis);
      const o = snapOrigin(drag.cx ?? drag.sx, drag.cy ?? drag.sy, axis);
      return { id: "__new", kind: tool.kind, capacity: tool.kind === "bridge" ? 1 : tool.capacity, axis, x: o.x, y: o.y, w, h } as ManualPiece;
    }
    const p = pieces.find((q) => q.id === drag.id);
    return p ? { ...p, x: drag.nx, y: drag.ny } : null;
  })();

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!manual) return;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    placeAt((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
  };

  const placeAt = (fx: number, fy: number) => {
    if (tool.kind === "erase") {
      const hit = pieceAtPoint(pieces, fx, fy);
      if (hit) {
        setPieces((prev) => prev.filter((p) => p.id !== hit.id));
        setPlaceError(null);
      }
      return;
    }

    const { w, h } = pieceFootprint(tool.kind, tool.capacity, axis);
    const { x, y } = snapOrigin(fx, fy, axis);
    const cand: ManualPiece = {
      id: `p${nextId.current++}`,
      kind: tool.kind,
      capacity: tool.kind === "bridge" ? 1 : tool.capacity,
      axis,
      x,
      y,
      w,
      h,
    };

    if (x < 0 || y < 0 || x + w > width || y + h > length) {
      setPlaceError("That piece would hang off the stage.");
      return;
    }
    if (pieces.some((p) => rectsOverlap(p, cand))) {
      setPlaceError("That space is already taken — erase what's there first.");
      return;
    }
    if (cand.kind === "holder") {
      const used = pieces.filter((p) => p.kind === "holder" && p.capacity === cand.capacity).length;
      const avail =
        cand.capacity === 1 ? stock.one : cand.capacity === 2 ? stock.two : stock.three;
      if (used + 1 > avail) {
        setPlaceError(`No ${cand.capacity}-deck holders left for this stage (${avail} available).`);
        return;
      }
      const deckCount = pieces.reduce((n, p) => n + (p.kind === "holder" ? p.capacity : 1), 0);
      if (deckCount + cand.capacity > stock.decks) {
        setPlaceError(`That would need more than the ${stock.decks} decks available.`);
        return;
      }
    } else {
      if (!bridgeSupport(pieces, cand)) {
        setPlaceError("A bridge needs a holder on both sides of it — place the holders first.");
        return;
      }
      const deckCount = pieces.reduce((n, p) => n + (p.kind === "holder" ? p.capacity : 1), 0);
      if (deckCount + 1 > stock.decks) {
        setPlaceError(`That would need more than the ${stock.decks} decks available.`);
        return;
      }
    }

    setPieces((prev) => [...prev, cand]);
    setPlaceError(null);
  };

  const totalArea = width * length;


  const [stairs, setStairs] = useState({ s5: 0, s6: 0, s7: 0 });
  const baseUsage = useMemo<Stock>(() => {
    if (!result.ok) return { decks: 0, one: 0, two: 0, three: 0 };
    if (singleAllocation && result.decks.length === 1 && result.holders.length === 1) return singleAllocation.usage;
    const u = { decks: result.decks.length, one: 0, two: 0, three: 0 };
    for (const h of result.holders) {
      if (h.capacity === 1) u.one++;
      if (h.capacity === 2) u.two++;
      if (h.capacity === 3) u.three++;
    }
    return { decks: u.decks * stageQuantity, one: u.one * stageQuantity, two: u.two * stageQuantity, three: u.three * stageQuantity };
  }, [result, stageQuantity, singleAllocation]);
  const maxLooseBridges = Math.max(0, stock.decks - baseUsage.decks);
  const usage = useMemo<Stock>(() => ({ ...baseUsage, decks: baseUsage.decks + Math.min(looseBridges, maxLooseBridges), ...stairs }), [baseUsage, stairs, looseBridges, maxLooseBridges]);

  useEffect(() => {
    onUsage?.(usage);
  }, [usage, onUsage]);

  const maxPx = 480;
  const scale = Math.min(maxPx / Math.max(width, 1), maxPx / Math.max(length, 1), 32);
  const canvasW = width * scale;
  const canvasH = length * scale;




  useEffect(() => {
    onLayoutChange?.({
      id: stageId, name: displayTitle, width, length, heightIn, quantity: stageQuantity,
      looseBridges: Math.min(looseBridges, maxLooseBridges),
      valid: result.ok && !result.holderError,
      decks: result.ok ? result.decks : [],
      holders: result.ok ? result.holders : [],
      copyHolders: result.ok && singleAllocation && result.decks.length === 1 && result.holders.length === 1
        ? singleAllocation.capacities.map(capacity => result.holders.map(h => ({ ...h, capacity }))) : undefined,
    });
  }, [stageId, displayTitle, width, length, heightIn, stageQuantity, result, singleAllocation, onLayoutChange, looseBridges, maxLooseBridges]);


  return (
      <div className="print-stage mb-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">{displayTitle}</h2>

        <div className="print-stage-body grid gap-6 md:grid-cols-[280px_1fr]">
          <div className="print-hide rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium">Stage name</label>
                <input
                  type="text"
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder={title}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Width (ft)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Length / Depth (ft)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <div className="block text-sm font-medium">Stairs</div>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {STAIR_TYPES.map(({ key, label }) => {
                    const max = stock[key] ?? 0;
                    return (
                      <label key={key} className="text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <input
                          type="number"
                          min={0}
                          max={max}
                          step={1}
                          value={stairs[key]}
                          onChange={(e) => {
                            const n = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)));
                            setStairs((prev) => ({ ...prev, [key]: n }));
                          }}
                          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <span className="text-muted-foreground">{max} available</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {isSingleDeckStage && (
                <div>
                  <label htmlFor={`${stageId}-quantity`} className="block text-sm font-medium">Number of 4×8 stages</label>
                  <input id={`${stageId}-quantity`} type="number" min={1} max={INVENTORY.totalDecks} step={1}
                    value={quantityText}
                    onChange={event => {
                      const text = event.target.value;
                      setQuantityText(text);
                      const parsed = stageQuantitySchema.safeParse(text === "" ? undefined : Number(text));
                      if (parsed.success) { setQuantity(parsed.data); setQuantityError(""); }
                      else setQuantityError(`Enter a whole number from 1 to ${INVENTORY.totalDecks}.`);
                    }}
                    onBlur={() => { setQuantityText(String(quantity)); setQuantityError(""); }}
                    aria-invalid={!!quantityError} aria-describedby={quantityError ? `${stageId}-quantity-error` : undefined}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  {quantityError && <p id={`${stageId}-quantity-error`} role="alert" className="mt-1 text-xs text-destructive">{quantityError}</p>}
                  <label htmlFor={`${stageId}-loose-bridges`} className="mt-3 block text-sm font-medium">Loose bridge decks</label>
                  <input id={`${stageId}-loose-bridges`} type="number" min={0} max={maxLooseBridges} step={1}
                    value={looseBridgesRaw}
                    onChange={event => {
                      const n = Math.floor(Number(event.target.value) || 0);
                      setLooseBridges(Math.max(0, Math.min(n, maxLooseBridges)));
                    }}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  <p className="mt-1 text-xs text-muted-foreground">Unattached 4×8 decks you can move in Layout view ({maxLooseBridges} decks available).</p>
                </div>
              )}

              <div>
                <label htmlFor={`${stageId}-height`} className="block text-sm font-medium">
                  Stage height (in)
                </label>
                <select
                  id={`${stageId}-height`}
                  value={heightIn}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setHeightIn(n);
                    setHeightText(String(n));
                  }}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {(HEIGHT_PRESETS.includes(heightIn) ? HEIGHT_PRESETS : [heightIn, ...HEIGHT_PRESETS].sort((a, b) => a - b)).map((h) => (
                    <option key={h} value={h}>
                      {h}&quot;
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-md border border-border p-3">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setManual(false)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      !manual
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Auto layout
                  </button>
                  <button
                    type="button"
                    onClick={enterManual}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      manual
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Place by hand
                  </button>
                </div>

                <div className="mt-3 space-y-1.5 text-xs">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={mostlyThree}
                      onChange={(e) => setMostlyThree(e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    Use mostly 3-deck holders
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allowTwo}
                      onChange={(e) => setAllowTwo(e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    Allow 2-deck holders
                  </label>
                </div>

                {manual && (
                  <div className="mt-3 space-y-3 text-xs">
                    <p className="text-muted-foreground">
                      Pick a piece, then click the top view to drop it there.
                    </p>

                    <div className="flex flex-wrap gap-1">
                      {([3, 2, 1] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setTool({ kind: "holder", capacity: c })}
                          className={`rounded-md border px-2 py-1 transition-colors ${
                            tool.kind === "holder" && tool.capacity === c
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {c}-deck holder
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setTool({ kind: "bridge", capacity: 1 })}
                        className={`rounded-md border px-2 py-1 transition-colors ${
                          tool.kind === "bridge"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Bridge deck
                      </button>
                      <button
                        type="button"
                        onClick={() => setTool({ kind: "erase", capacity: 1 })}
                        className={`rounded-md border px-2 py-1 transition-colors ${
                          tool.kind === "erase"
                            ? "border-destructive bg-destructive text-white"
                            : "border-border bg-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Remove
                      </button>
                    </div>

                    <div>
                      <div className="mb-1 font-medium">Direction</div>
                      <div className="flex gap-1">
                        {([
                          ["x", "Across (left → right)"],
                          ["y", "Down (front → back)"],
                        ] as const).map(([a, labelText]) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setAxis(a)}
                            className={`flex-1 rounded-md border px-2 py-1 transition-colors ${
                              axis === a
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {labelText}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={loadAutoPlan}
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:bg-muted"
                      >
                        Reset to auto plan
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPieces([]);
                          setPlaceError(null);
                        }}
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:bg-muted"
                      >
                        Clear stage
                      </button>
                    </div>

                    {placeError && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 font-medium text-destructive">
                        {placeError}
                      </div>
                    )}
                  </div>
                )}
              </div>


              <div className="rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">Stage area</span>
                  <span className="font-medium">{totalArea} sq ft</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">Stage height</span>
                  <span className="font-medium">{heightIn}&quot;</span>
                </div>
                {result.ok ? (
                  (() => {
                    const count = result.decks.length * stageQuantity;
                    const overDecks = count > stock.decks;
                    const totals = usage;
                    return (
                      <>
                        <div className="mt-2 flex justify-between border-t border-border pt-2">
                          <span className="text-muted-foreground">Decks required</span>
                          <span className={`font-semibold ${overDecks ? "text-destructive" : ""}`}>
                            {count} / {stock.decks}
                          </span>
                        </div>
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          <div>{totals.three}× 3-deck holder</div>
                          <div>{totals.two}× 2-deck holder</div>
                          <div>{totals.one}× 1-deck holder</div>
                          {singleAllocation && (usage.two > 0 || usage.three > 0) && <div className="font-medium text-foreground">Larger holders used with one deck each: {usage.two}× 2-deck, {usage.three}× 3-deck.</div>}
                          <div>{result.bridges.length * stageQuantity}× bridge deck (4&#39;×8&#39;)</div>
                        </div>
                        {result.holderError && (
                          <div className="mt-1 text-xs font-medium text-destructive">
                            {result.holderError}
                          </div>
                        )}
                        {overDecks && (
                          <div className="mt-1 text-xs font-medium text-destructive">
                            Exceeds the {stock.decks} decks available to this stage by {count - stock.decks}.
                          </div>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <div className="mt-2 border-t border-border pt-2 font-medium text-destructive">
                    Not buildable
                  </div>
                )}
              </div>

              {result.ok && result.holders.length > 0 && (
                <div className="rounded-md border border-border p-3 text-xs">
                  <div className="mb-2 font-semibold">Legend</div>
                  <div className="space-y-1">
                    {([3, 2, 1] as const).map((c) => (
                      <div key={c} className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-sm"
                          style={{ background: HOLDER_COLORS[c] }}
                        />
                        <span>{c}-deck holder ({c * 4}&#39;×8&#39;)</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: BRIDGE_COLOR }}
                      />
                      <span>Bridge deck (4&#39;×8&#39;)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              {result.ok ? (
                <>
                  <div className="mb-1 text-sm font-semibold">Top view (plan)</div>
                  <div className="mb-3 text-xs text-muted-foreground">
                    Each thin rectangle is one 4&#39;×8&#39; deck. Coloured outlines show holders.
                  </div>

                  <div
                    className="stage-diagram-wrapper overflow-auto"
                    style={{ "--diagram-h": `${canvasH}px` } as React.CSSProperties}
                  >
                    <div
                      className={`stage-diagram relative border border-border bg-muted/40 ${
                        manual ? "cursor-crosshair" : ""
                      }`}
                      style={{ width: canvasW || 1, height: canvasH || 1 }}
                      onClick={handleStageClick}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={() => setDrag(null)}
                    >
                      {dragGhost && (
                        <div
                          className="pointer-events-none absolute z-20 rounded-sm border-2 border-dashed border-foreground bg-foreground/20"
                          style={{
                            left: dragGhost.x * scale,
                            top: dragGhost.y * scale,
                            width: dragGhost.w * scale,
                            height: dragGhost.h * scale,
                          }}
                        />
                      )}

                      {result.decks.map((d, i) => (
                        <div
                          key={i}
                          className={`deck-cell absolute flex items-center justify-center border border-background/60 text-[10px] font-medium ${
                            d.isBridge ? "text-black" : "bg-primary/70 text-primary-foreground"
                          }`}
                          style={{
                            left: d.x * scale,
                            top: d.y * scale,
                            width: d.w * scale,
                            height: d.h * scale,
                            ...(d.isBridge ? { background: BRIDGE_COLOR } : {}),
                          }}
                          title={d.isBridge ? "Bridge deck (no holder)" : `${d.w}ft × ${d.h}ft deck`}
                        >
                          {d.isBridge ? "BRIDGE" : `${d.w}×${d.h}`}
                        </div>
                      ))}
                      {result.holders.map((h, i) => (
                        <div
                          key={`h${i}`}
                          className="pointer-events-none absolute flex flex-col items-start justify-start"
                          style={{
                            left: h.x * scale,
                            top: h.y * scale,
                            width: h.w * scale,
                            height: h.h * scale,
                            border: `3px solid ${HOLDER_COLORS[h.capacity]}`,
                            boxSizing: "border-box",
                          }}
                          title={`${h.label}: ${h.capacity}-deck holder`}
                        >
                          <span
                            className="m-0.5 rounded px-1 text-[10px] font-bold text-white"
                            style={{ background: HOLDER_COLORS[h.capacity] }}
                          >
                            {h.label}
                          </span>
                          <div className="flex w-full flex-1 flex-col items-center justify-center px-1 text-center leading-tight">
                            <span className="text-[10px] font-semibold text-white drop-shadow">
                              {h.capacity}-Deck Holder
                            </span>
                            <span className="text-[10px] text-white/90 drop-shadow">
                              {h.w}×{h.h}
                            </span>
                            <span className="hidden text-[10px] font-semibold text-white drop-shadow print:inline-block">
                              {heightIn}&quot; high
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>



                  <p className="mt-3 text-xs text-muted-foreground">
                    Scale: 1 ft ≈ {scale.toFixed(1)} px. Origin (0,0) is top-left.
                  </p>

                  {result.ok && (
                    <div className="print-only mt-4 rounded border border-border bg-card p-3 text-sm">
                      <div className="font-semibold">{displayTitle} summary</div>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span>Width:</span>
                        <span className="font-medium">{width}&#39;</span>
                        <span>Length:</span>
                        <span className="font-medium">{length}&#39;</span>
                        <span>Height:</span>
                        <span className="font-medium">{heightIn}&quot;</span>
                        <span>Stage quantity:</span>
                        <span className="font-medium">{stageQuantity}</span>
                        <span>Total decks:</span>
                        <span className="font-medium">{result.decks.length * stageQuantity}</span>
                        <span>Bridge decks:</span>
                        <span className="font-medium">{result.bridges.length}</span>
                        <span>3-deck holders:</span>
                        <span className="font-medium">
                          {usage.three}
                        </span>
                        <span>2-deck holders:</span>
                        <span className="font-medium">
                          {usage.two}
                        </span>
                        <span>1-deck holders:</span>
                        <span className="font-medium">
                          {usage.one}
                        </span>
                        {STAIR_TYPES.filter(({ key }) => stairs[key] > 0).map(({ key, label }) => (
                          <Fragment key={key}>
                            <span>{label}:</span>
                            <span className="font-medium">{stairs[key]}</span>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  )}

                </>
              ) : (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  <p className="font-semibold">Can&#39;t build this stage</p>
                  <p className="mt-1">{result.reason}</p>
                  <p className="mt-2 text-destructive/80">
                    Try sizes where both dimensions are multiples of 4 ft and at least one is a multiple of 8 ft (e.g. 16×20, 24×16, 32×12).
                  </p>
                </div>
              )}
            </div>





            {result.ok && result.holders.length > 0 && (
              <div className="print-hide rounded-lg border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 text-sm font-semibold">Holder placement</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3">Holder</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Decks</th>
                        <th className="py-2 pr-3">Footprint</th>
                        <th className="py-2 pr-3">Position (x, y) ft</th>
                        <th className="py-2 pr-3">Spans (ft)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.holders.map((h) => (
                      <tr key={h.label} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 font-semibold">
                          <span
                            className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                            style={{ background: HOLDER_COLORS[h.capacity] }}
                          />
                          {h.label}
                        </td>
                        <td className="py-2 pr-3">{h.capacity}-deck</td>
                        <td className="py-2 pr-3">{h.decksUsed ?? h.capacity}</td>
                        <td className="py-2 pr-3">{h.w}&#39; × {h.h}&#39;</td>
                        <td className="py-2 pr-3">({h.x}, {h.y})</td>
                        <td className="py-2 pr-3">
                          x: {h.x}–{h.x + h.w}, y: {h.y}–{h.y + h.h}
                        </td>
                      </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.ok && result.bridges.length > 0 && (
              <div className="print-hide rounded-lg border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 text-sm font-semibold">Bridge placement</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3">Bridge</th>
                        <th className="py-2 pr-3">Between</th>
                        <th className="py-2 pr-3">Footprint</th>
                        <th className="py-2 pr-3">Position (x, y) ft</th>
                        <th className="py-2 pr-3">Spans (ft)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.bridges.map((br) => (
                        <tr key={br.label} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-3 font-semibold">
                            <span
                              className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                              style={{ background: BRIDGE_COLOR }}
                            />
                            {br.label}
                          </td>
                          <td className="py-2 pr-3">{br.between[0]} ↔ {br.between[1]}</td>
                          <td className="py-2 pr-3">{br.w}&#39; × {br.h}&#39;</td>
                          <td className="py-2 pr-3">({br.x}, {br.y})</td>
                          <td className="py-2 pr-3">
                            x: {br.x}–{br.x + br.w}, y: {br.y}–{br.y + br.h}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
  );
}

export function DeckPlanner() {
  const [stageCount, setStageCount] = useState(1);
  const [usedByStage, setUsedByStage] = useState<Stock[]>([]);
  // Stable per-stage usage callbacks: StagePanel's effect depends on onUsage,
  // so each index must keep the same function identity across renders.
  const usedCallbacks = useRef(new Map<number, (stock: Stock) => void>());
  const setUsedFor = (index: number) => {
    let cb = usedCallbacks.current.get(index);
    if (!cb) {
      cb = (stock: Stock) =>
        setUsedByStage((previous) => {
          const next = [...previous];
          next[index] = stock;
          return next;
        });
      usedCallbacks.current.set(index, cb);
    }
    return cb;
  };
  const [rebuildKey, setRebuildKey] = useState(0);
  const [eventName, setEventName] = useState("");
  const [eventNameDraft, setEventNameDraft] = useState("");
  const [showEventModal, setShowEventModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearKey, setClearKey] = useState(0);
  const [showLayout, setShowLayout] = useState(false);
  const [layoutStages, setLayoutStages] = useState<Record<string, LayoutStage>>({});
  const handleLayoutChange = useCallback((stage: LayoutStage) => {
    setLayoutStages(previous => ({ ...previous, [stage.id]: stage }));
  }, []);
  const [removedIndexes, setRemovedIndexes] = useState<number[]>([]);
  const enabledIndexes = Array.from({ length: stageCount }, (_, i) => i).filter(
    (i) => !removedIndexes.includes(i),
  );
  const enabledIds = enabledIndexes.map((i) => `s${i + 1}`);
  const activeLayoutStages = enabledIds.flatMap(id => {
    const stage = layoutStages[id];
    if (!stage) return [];
    const parsed = stageQuantitySchema.safeParse(stage.quantity ?? 1);
    const count = parsed.success ? parsed.data : 1;
    const copies: LayoutStage[] = Array.from({ length: count }, (_, index) => ({ ...stage,
      holders: stage.copyHolders?.[index] ?? stage.holders,
      id: index === 0 ? stage.id : `${stage.id}-copy-${index + 1}`,
      name: count === 1 ? stage.name : `${stage.name} ${index + 1}`,
    }));
    const bridges: LayoutStage[] = Array.from({ length: stage.looseBridges ?? 0 }, (_, index) => ({
      id: `${stage.id}-bridge-${index + 1}`, name: `${stage.name} bridge ${index + 1}`,
      width: 4, length: 8, heightIn: stage.heightIn, valid: true,
      decks: [{ x: 0, y: 0, w: 4, h: 8, isBridge: true }], holders: [],
    }));
    return [...copies, ...bridges];
  });

  // Persist which stages are enabled and the event name across reloads.
  const skipAppSave = useRef(true);
  useEffect(() => {
    const s = readStored<SavedApp>(APP_STORE_KEY, {});
    if (typeof s.stageCount === "number" && s.stageCount >= 1 && s.stageCount <= 10) {
      setStageCount(Math.floor(s.stageCount));
    } else if (typeof s.showSecond === "boolean") {
      // Migrate the old per-stage checkboxes into a stage count.
      let count = 1;
      if (s.showSecond) count = 2;
      if (s.showSecond && s.showThird) count = 3;
      if (s.showSecond && s.showThird && s.showFourth) count = 4;
      if (s.showSecond && s.showThird && s.showFourth && s.showFifth) count = 5;
      setStageCount(count);
    }
    if (typeof s.eventName === "string") setEventName(s.eventName);
    skipAppSave.current = true;
  }, []);
  useEffect(() => {
    if (skipAppSave.current) {
      skipAppSave.current = false;
      return;
    }
    writeStored(APP_STORE_KEY, { stageCount, eventName });
  }, [stageCount, eventName]);

  // Chain stock only through the stages that are still enabled, in order.
  const { remainingBefore, remainingFinal } = useMemo(() => {
    const before = new Map<number, Stock>();
    let current = FULL_STOCK;
    for (const i of enabledIndexes) {
      before.set(i, current);
      const used = usedByStage[i] ?? { decks: 0, one: 0, two: 0, three: 0 };
      current = {
        decks: Math.max(0, current.decks - used.decks),
        one: Math.max(0, current.one - used.one),
        two: Math.max(0, current.two - used.two),
        three: Math.max(0, current.three - used.three),
        s5: Math.max(0, (current.s5 ?? 0) - (used.s5 ?? 0)),
        s6: Math.max(0, (current.s6 ?? 0) - (used.s6 ?? 0)),
        s7: Math.max(0, (current.s7 ?? 0) - (used.s7 ?? 0)),
      };
    }
    return { remainingBefore: before, remainingFinal: current };
  }, [usedByStage, enabledIndexes]);

  // Remove one stage, free its inventory, and rebuild the stages that remain.
  const removeStage = (index: number) => {
    setRemovedIndexes((previous) => [...previous, index]);
    setUsedByStage((previous) => {
      const next = [...previous];
      next[index] = { decks: 0, one: 0, two: 0, three: 0 };
      return next;
    });
    setLayoutStages((previous) => {
      const next = { ...previous };
      delete next[`s${index + 1}`];
      return next;
    });
    setRebuildKey((k) => k + 1);
  };
  const totalUsed = useMemo<Stock>(
    () => ({
      decks: FULL_STOCK.decks - remainingFinal.decks,
      one: FULL_STOCK.one - remainingFinal.one,
      two: FULL_STOCK.two - remainingFinal.two,
      three: FULL_STOCK.three - remainingFinal.three,
      s5: (FULL_STOCK.s5 ?? 0) - (remainingFinal.s5 ?? 0),
      s6: (FULL_STOCK.s6 ?? 0) - (remainingFinal.s6 ?? 0),
      s7: (FULL_STOCK.s7 ?? 0) - (remainingFinal.s7 ?? 0),
    }),
    [remainingFinal],
  );


  return (
    <div className="deck-planner bg-background text-foreground">
      <div className="print-document mx-auto max-w-5xl px-1 py-2">
        <header className="print-hide mb-6">
          <h1 className="text-xl font-bold tracking-tight">Stage Deck Planner</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lay out a stage using the fewest 4&#39;×8&#39; decks possible. Inventory: 72 decks, 4×1-deck (4&#39;×8&#39;) + 8×2-deck (8&#39;×8&#39;) + 8×3-deck (12&#39;×8&#39;) holders, plus 1×5-step, 2×6-step and 5×7-step stairs.
            A <span className="font-medium" style={{ color: BRIDGE_COLOR }}>bridge</span> is a single deck spanning between two holders — adds coverage without using another holder.
          </p>
        </header>

        <div className="no-print mb-6 rounded-md border border-border bg-card p-4 text-sm shadow-sm">
          <div className="font-semibold">Total inventory (all stages)</div>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <span className="text-muted-foreground">Decks: </span>
              {totalUsed.decks} used / {remainingFinal.decks} left
            </div>
            <div>
              <span className="text-muted-foreground">3-deck holders: </span>
              {totalUsed.three} used / {remainingFinal.three} left
            </div>
            <div>
              <span className="text-muted-foreground">2-deck holders: </span>
              {totalUsed.two} used / {remainingFinal.two} left
            </div>
            <div>
              <span className="text-muted-foreground">1-deck holders: </span>
              {totalUsed.one} used / {remainingFinal.one} left
            </div>
            {STAIR_TYPES.map(({ key, label }) => (
              <div key={key}>
                <span className="text-muted-foreground">{label}: </span>
                {totalUsed[key] ?? 0} used / {remainingFinal[key] ?? 0} left
              </div>
            ))}
          </div>
        </div>

        <div className="print-only mb-6">
          <h1 className="text-3xl font-bold tracking-tight">
            {eventName.trim() || "Stage Deck Planner"}
          </h1>
          <section className="mt-4 break-inside-avoid" aria-labelledby="print-items-title">
            <h2 id="print-items-title" className="text-sm font-semibold">All items used (all stages)</h2>
            <dl className="mt-2 grid grid-cols-4 gap-3 border-y border-border py-2 text-xs">
              <div><dt>4′ × 8′ decks</dt><dd className="mt-1 font-semibold">{totalUsed.decks}</dd></div>
              <div><dt>3-deck holders</dt><dd className="mt-1 font-semibold">{totalUsed.three}</dd></div>
              <div><dt>2-deck holders</dt><dd className="mt-1 font-semibold">{totalUsed.two}</dd></div>
              <div><dt>1-deck holders</dt><dd className="mt-1 font-semibold">{totalUsed.one}</dd></div>
              {STAIR_TYPES.map(({ key, label }) => (
                <div key={key}><dt>{label}</dt><dd className="mt-1 font-semibold">{totalUsed[key] ?? 0}</dd></div>
              ))}
            </dl>
          </section>
        </div>

        <label className="no-print mb-6 flex w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm">
          <span className="font-medium">Number of stages</span>
          <select
            value={stageCount}
            onChange={(e) => {
              setStageCount(Number(e.target.value));
              setRemovedIndexes([]);
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm outline-none ring-ring focus:ring-2"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">(each with its own width, length &amp; height)</span>
        </label>

        <button
          type="button"
          onClick={() => {
            setEventNameDraft(eventName);
            setShowEventModal(true);
          }}
          className="no-print mb-6 ml-3 rounded-md border border-border bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          Print stages side by side
        </button>

        {enabledIndexes.length > 1 && (
          <button
            type="button"
            onClick={() => setRebuildKey((k) => k + 1)}
            className="no-print mb-6 ml-3 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted"
          >
            Rebuild all stages
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowClearModal(true)}
          className="no-print mb-6 ml-3 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-destructive shadow-sm hover:bg-muted"
        >
          Clear all stages
        </button>

        <button
          type="button"
          onClick={() => setShowLayout(show => !show)}
          aria-expanded={showLayout}
          className={`no-print mb-6 ml-3 rounded-md border border-border px-3 py-2 text-sm font-medium shadow-sm hover:bg-muted ${showLayout ? "bg-muted font-semibold" : "bg-card"}`}
        >
          {showLayout ? "Hide Layout view" : "Show Layout view"}
        </button>

        <div className={`layout-view-swap${showLayout ? "" : " hidden"}`}>
          <StageLayout stages={activeLayoutStages} />
        </div>

        <div className="print-grid">
        {enabledIndexes.map((i, position) => {
          const id = `s${i + 1}`;
          const n = position + 1;
          const stock = position === 0 ? undefined : remainingBefore.get(i);
          return (
            <div key={`${id}-${clearKey}`}>
              {position > 0 && stock && (
                <div className="print-hide mb-4 rounded-md border border-border bg-muted p-3 text-sm">
                  <div className="font-semibold">
                    Left for Stage {n} after {position === 1 ? "Stage 1" : `Stages 1–${position}`}
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
                    <div>{stock.decks} decks</div>
                    <div>{stock.three}× 3-deck holder</div>
                    <div>{stock.two}× 2-deck holder</div>
                    <div>{stock.one}× 1-deck holder</div>
                  </div>
                </div>
              )}
              <div className="no-print mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeStage(i)}
                  className="rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-destructive shadow-sm hover:bg-muted"
                >
                  Remove stage
                </button>
              </div>
              <StagePanel
                stageId={id}
                onLayoutChange={handleLayoutChange}
                title={enabledIndexes.length > 1 ? `Stage ${n}` : "Stage"}
                defaultWidth={i === 0 ? 24 : i === 1 ? 16 : 8}
                defaultLength={i <= 1 ? (i === 0 ? 16 : 8) : 8}
                labelPrefix={i === 0 ? undefined : `S${i + 1}-`}
                stock={stock}
                onUsage={setUsedFor(i)}
                rebuildKey={rebuildKey}
              />
            </div>
          );
        })}
        </div>

        {showEventModal && createPortal(
          <div className="no-print fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
              <div className="mb-4 text-lg font-semibold">Enter Event Name</div>
              <input
                type="text"
                value={eventNameDraft}
                onChange={(e) => setEventNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setEventName(eventNameDraft);
                    setShowEventModal(false);
                    setTimeout(printDeck, 0);
                  }
                  if (e.key === "Escape") {
                    setShowEventModal(false);
                  }
                }}
                placeholder="Event name"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                autoFocus
              />
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEventName(eventNameDraft);
                    setShowEventModal(false);
                    setTimeout(printDeck, 0);
                  }}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
          , document.body)}

        {showClearModal && createPortal(
          <div className="no-print fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
              <div className="mb-4 text-lg font-semibold">Are you sure you want to clear everything?</div>
              <div className="mb-2 text-sm text-muted-foreground">
                All stages, dimensions, names, hand-placed pieces, and the event name will be reset.
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowClearModal(false)}
                  className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowClearModal(false);
                    window.localStorage.removeItem(STAGE_STORE_KEY);
                    window.localStorage.removeItem(APP_STORE_KEY);
                    skipAppSave.current = true;
                    setUsedByStage([]);
                    setRemovedIndexes([]);
                    setStageCount(1);
                    setEventName("");
                    setEventNameDraft("");
                    setLayoutStages({});
                    setRebuildKey((k) => k + 1);
                    setClearKey((k) => k + 1);
                  }}
                  className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
          , document.body)}
      </div>
    </div>
  );
}