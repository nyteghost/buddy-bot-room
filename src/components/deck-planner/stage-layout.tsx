// @ts-nocheck -- ported unchanged from the Deck Builder Pro repo, which type-checks under looser settings than this app.
import { useMemo, useRef, useState } from "react";
import { Move, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type LayoutStage = {
  id: string;
  name: string;
  width: number;
  length: number;
  heightIn: number;
  valid: boolean;
  quantity?: number;
  looseBridges?: number;
  copyHolders?: LayoutStage["holders"][];
  decks: { x: number; y: number; w: number; h: number; isBridge?: boolean }[];
  holders: { x: number; y: number; w: number; h: number; capacity: 1 | 2 | 3 }[];
};
type Position = { x: number; y: number };

export function StageLayout({ stages: sourceStages }: { stages: LayoutStage[] }) {
  const [rotations, setRotations] = useState<Record<string, boolean>>({});
  const stages = useMemo(() => sourceStages.map(stage => {
    const singleDeck = stage.decks.length === 1 && stage.width * stage.length === 32;
    if (!rotations[stage.id] || !singleDeck) return stage;
    const turn = <T extends { x: number; y: number; w: number; h: number }>(piece: T): T => ({
      ...piece, x: stage.length - piece.y - piece.h, y: piece.x, w: piece.h, h: piece.w,
    });
    return { ...stage, width: stage.length, length: stage.width,
      decks: stage.decks.map(turn), holders: stage.holders.map(turn) };
  }), [sourceStages, rotations]);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [selectedId, setSelectedId] = useState("s1");
  const [zoom, setZoom] = useState(8);
  const [error, setError] = useState("");
  const drag = useRef<{ id: string; startX: number; startY: number; origin: Position } | null>(null);
  const defaults = useMemo(() => {
    let x = 4;
    return Object.fromEntries(stages.map(stage => {
      const position = { x, y: 4 };
      x += stage.width + 4;
      return [stage.id, position];
    }));
  }, [stages]);
  const positionOf = (id: string): Position => positions[id] ?? defaults[id] ?? { x: 4, y: 4 };
  const selected = stages.find(stage => stage.id === selectedId) ?? stages[0];
  const worldWidth = Math.max(100, ...stages.map(stage => positionOf(stage.id).x + stage.width + 12));
  const worldHeight = Math.max(64, ...stages.map(stage => positionOf(stage.id).y + stage.length + 12));
  const overlaps = (stage: LayoutStage, position: Position) => stages.some(other => {
    if (other.id === stage.id) return false;
    const p = positionOf(other.id);
    return position.x < p.x + other.width && position.x + stage.width > p.x &&
      position.y < p.y + other.length && position.y + stage.length > p.y;
  });
  const moveStage = (stage: LayoutStage, position: Position) => {
    const snapped = { x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) };
    if (overlaps(stage, snapped)) {
      setError(`${stage.name} overlaps another stage. Choose an open position.`);
      return false;
    }
    setPositions(previous => ({ ...previous, [stage.id]: snapped }));
    setError("");
    return true;
  };
  const canRotate = selected?.valid && selected.decks.length === 1 && selected.width * selected.length === 32;
  const rotateSelected = () => {
    if (!selected || !canRotate) return;
    const position = positionOf(selected.id);
    const turned = { ...selected, width: selected.length, length: selected.width };
    if (overlaps(turned, position)) {
      setError(`${selected.name} would overlap another stage after rotation. Move it to an open position first.`);
      return;
    }
    // Freeze positions before rotation changes the default row spacing.
    setPositions(Object.fromEntries(stages.map(stage => [stage.id, positionOf(stage.id)])));
    setRotations(previous => ({ ...previous, [selected.id]: !previous[selected.id] }));
    setError("");
  };
  const printBounds = {
    x: stages.length ? Math.max(0, Math.min(...stages.map(stage => positionOf(stage.id).x)) - 2) : 0,
    y: stages.length ? Math.max(0, Math.min(...stages.map(stage => positionOf(stage.id).y)) - 2) : 0,
    right: Math.max(8, ...stages.map(stage => positionOf(stage.id).x + stage.width)) + 2,
    bottom: Math.max(8, ...stages.map(stage => positionOf(stage.id).y + stage.length)) + 2,
  };

  return (
    <section className="print-layout mb-10" aria-labelledby="layout-title">
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="layout-title" className="text-lg font-semibold">Layout view</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Zoom
            <input aria-label="Layout zoom" type="range" min={4} max={16} value={zoom}
              onChange={event => setZoom(Number(event.target.value))} className="w-24 accent-primary" />
          </label>
          <Button variant="outline" size="icon" title="Rotate selected single-deck stage 90°" aria-label="Rotate selected single-deck stage 90°"
            disabled={!canRotate} onClick={rotateSelected}><RotateCw /></Button>
          <Button variant="outline" size="icon" title="Reset stage positions" aria-label="Reset stage positions"
            onClick={() => { setPositions({}); setRotations({}); setError(""); }}><RotateCcw /></Button>
        </div>
      </div>
      <div className="no-print overflow-auto rounded-md border border-border bg-muted/30" style={{ maxHeight: 580 }}>
        <div className="layout-workspace relative" aria-label="Stage layout canvas"
          style={{ width: worldWidth * zoom, height: worldHeight * zoom, backgroundSize: `${4 * zoom}px ${4 * zoom}px` }}>
          <span className="pointer-events-none absolute left-2 top-1 text-[10px] text-muted-foreground">0, 0 · feet</span>
          {stages.map(stage => {
            const position = positionOf(stage.id);
            const isSelected = selected?.id === stage.id;
            return (
              <Button key={stage.id} variant="outline" aria-label={`Move ${stage.name}`} aria-pressed={isSelected}
                data-stage-id={stage.id} data-x={position.x} data-y={position.y} data-rotated={!!rotations[stage.id]}
                title={`${stage.name}: ${stage.width} × ${stage.length} ft, ${stage.heightIn} in high`}
                className={`absolute block touch-none select-none overflow-hidden rounded-none p-0 shadow-none cursor-grab active:cursor-grabbing [&_svg]:size-full ${isSelected ? "z-10 ring-2 ring-ring ring-offset-2 ring-offset-background" : ""} ${!stage.valid ? "border-dashed border-destructive" : "border-foreground"}`}
                style={{ left: position.x * zoom, top: position.y * zoom, width: stage.width * zoom, height: stage.length * zoom }}
                onClick={() => setSelectedId(stage.id)}
                onPointerDown={event => {
                  if (event.button !== 0) return;
                  setSelectedId(stage.id);
                  setError("");
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { id: stage.id, startX: event.clientX, startY: event.clientY, origin: position };
                }}
                onPointerMove={event => {
                  const current = drag.current;
                  if (!current || current.id !== stage.id) return;
                  const next = {
                    x: Math.max(0, Math.round(current.origin.x + (event.clientX - current.startX) / zoom)),
                    y: Math.max(0, Math.round(current.origin.y + (event.clientY - current.startY) / zoom)),
                  };
                  setPositions(previous => ({ ...previous, [stage.id]: next }));
                }}
                onPointerUp={event => {
                  const current = drag.current;
                  if (!current || current.id !== stage.id) return;
                  const next = positionOf(stage.id);
                  if (!moveStage(stage, next)) setPositions(previous => ({ ...previous, [stage.id]: current.origin }));
                  drag.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  const current = drag.current;
                  if (current) setPositions(previous => ({ ...previous, [current.id]: current.origin }));
                  drag.current = null;
                }}
                onKeyDown={event => {
                  const steps: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
                  const step = steps[event.key];
                  if (!step) return;
                  event.preventDefault();
                  setSelectedId(stage.id);
                  moveStage(stage, { x: position.x + step.x, y: position.y + step.y });
                }}>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${stage.width} ${stage.length}`} preserveAspectRatio="none" aria-hidden="true">
                  {stage.decks.map((deck, index) => <rect key={index} x={deck.x} y={deck.y} width={deck.w} height={deck.h}
                    className={deck.isBridge ? "layout-bridge" : "layout-deck"} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
                  {stage.holders.map((holder, index) => <rect key={index} x={holder.x} y={holder.y} width={holder.w} height={holder.h}
                    className={`layout-holder layout-holder-${holder.capacity}`} strokeWidth={3} vectorEffect="non-scaling-stroke" />)}
                </svg>
                <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 truncate bg-background/90 px-1 py-0.5 text-xs font-semibold">{stage.name}</span>
              </Button>
            );
          })}
        </div>
      </div>
      <div className="no-print mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        {selected && <>
          <span className="flex items-center gap-2 font-semibold"><Move className="size-4" />{selected.name}</span>
          <span>{selected.width} × {selected.length} ft · {selected.heightIn}" high</span>
          <span className="text-muted-foreground">X: {positionOf(selected.id).x} ft · Y: {positionOf(selected.id).y} ft</span>
          {!selected.valid && <span className="text-destructive">Stage plan unavailable</span>}
        </>}
        <span className="ml-auto text-muted-foreground">Grid: 4 ft · Snap: 1 ft</span>
      </div>
      {error && <p role="alert" className="no-print mt-2 text-sm text-destructive">{error}</p>}
      <div className="print-only">
        <h2 className="mb-3 text-lg font-semibold">Layout view</h2>
        <svg className="print-layout-diagram" role="img" aria-label="Complete arranged stage layout"
          viewBox={`${printBounds.x} ${printBounds.y} ${printBounds.right - printBounds.x} ${printBounds.bottom - printBounds.y}`}>
          {stages.map((stage, index) => {
            const position = positionOf(stage.id);
            const labelSize = Math.min(2, stage.width / 5, stage.length / 3);
            return <g key={stage.id} transform={`translate(${position.x} ${position.y})`}>
              <rect width={stage.width} height={stage.length} className="print-layout-outline" />
              {stage.decks.map((deck, deckIndex) => <rect key={deckIndex} x={deck.x} y={deck.y} width={deck.w} height={deck.h}
                className={deck.isBridge ? "layout-bridge" : "layout-deck"} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />)}
              {stage.holders.map((holder, holderIndex) => {
                const holderTextSize = Math.min(1.3, holder.w / 6, holder.h / 3);
                return <g key={holderIndex}>
                  <rect x={holder.x} y={holder.y} width={holder.w} height={holder.h}
                    className={`layout-holder layout-holder-${holder.capacity}`} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  <text x={holder.x + holder.w / 2} y={holder.y + holder.h / 2} textAnchor="middle" dominantBaseline="middle"
                    fontSize={holderTextSize} className="print-layout-number">{stage.heightIn}&quot; high</text>
                </g>;
              })}
              <text x={stage.width / 2} y={stage.length / 2} textAnchor="middle" dominantBaseline="middle"
                fontSize={labelSize} className="print-layout-number">{index + 1}</text>
            </g>;
          })}
        </svg>
        <table className="print-layout-key mt-4 w-full text-left text-xs">
          <thead><tr><th>#</th><th>Stage</th><th>Width × Length</th><th>Height</th><th>Position (x, y) ft</th></tr></thead>
          <tbody>{stages.map((stage, index) => <tr key={stage.id}>
            <td>{index + 1}</td><td>{stage.name}{!stage.valid ? " — plan unavailable" : ""}</td>
            <td>{stage.width}′ × {stage.length}′</td><td>{stage.heightIn}″</td>
            <td>({positionOf(stage.id).x}, {positionOf(stage.id).y})</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}