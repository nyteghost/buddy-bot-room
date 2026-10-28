import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { GripHorizontal, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampWindowPosition, readWindowPosition, resizeWindowRect, type WindowResizeEdge } from "@/lib/workspace";
import { cn } from "@/lib/utils";

let windowStack = 1;
const MIN_W = 320;
const MIN_H = 220;
type Size = { w: number; h: number };

function readSize(raw: string | null): Size | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? { w: v.w, h: v.h } : null;
  } catch { return null; }
}

export function WorkspaceWindow({ id, title, icon, open, onClose, children, resetVersion, className }: {
  className?: string;
  id: string; title: string; icon: ReactNode; open: boolean; onClose: () => void;
  children: ReactNode; resetVersion: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const resize = useRef<{ x: number; y: number; w: number; h: number; left: number; top: number; edge: WindowResizeEdge } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [front, setFront] = useState(1);
  const positionRef = useRef(position);
  positionRef.current = position;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const key = `pixel-pals-window-${id}-v1`;
  const sizeKey = `pixel-pals-window-${id}-size-v1`;
  useEffect(() => {
    if (open) setFront(++windowStack);
  }, [open]);
  useEffect(() => {
    try {
      setPosition(readWindowPosition(localStorage.getItem(key)));
      setSize(readSize(localStorage.getItem(sizeKey)));
    } catch { /* optional browser storage */ }
  }, [key, sizeKey]);
  useEffect(() => {
    if (!resetVersion) return;
    setPosition(null); setSize(null); setExpanded(false);
    try { localStorage.removeItem(key); localStorage.removeItem(sizeKey); } catch { /* optional storage */ }
  }, [resetVersion, key, sizeKey]);
  useEffect(() => {
    const element = ref.current;
    const parent = element?.parentElement;
    if (!element || !parent || !open) return;
    const observer = new ResizeObserver(() => {
      const current = positionRef.current;
      if (!current) return;
      const next = clampWindowPosition(current, parent.getBoundingClientRect(), element.getBoundingClientRect());
      if (next.x !== current.x || next.y !== current.y) setPosition(next);
    });
    observer.observe(parent); observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  const isMobile = () => window.matchMedia("(max-width: 700px)").matches;
  function begin(event: PointerEvent<HTMLDivElement>) {
    if (expanded || event.button !== 0 || (event.target as HTMLElement).closest("button") || isMobile()) return;
    const element = ref.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const rect = element.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, originX: rect.left - bounds.left, originY: rect.top - bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    const element = ref.current;
    const parent = element?.parentElement;
    if (!active || !element || !parent) return;
    setPosition(clampWindowPosition({ x: active.originX + event.clientX - active.x, y: active.originY + event.clientY - active.y }, parent.getBoundingClientRect(), element.getBoundingClientRect()));
  }
  function end() {
    if (!drag.current) return;
    drag.current = null;
    try { localStorage.setItem(key, JSON.stringify(positionRef.current)); } catch { /* optional storage */ }
  }
  function beginResize(edge: WindowResizeEdge) {
    return (event: PointerEvent<HTMLDivElement>) => {
      if (expanded || event.button !== 0 || isMobile()) return;
      const element = ref.current;
      const parent = element?.parentElement;
      if (!element || !parent) return;
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const bounds = parent.getBoundingClientRect();
      resize.current = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height, left: rect.left - bounds.left, top: rect.top - bounds.top, edge };
      event.currentTarget.setPointerCapture(event.pointerId);
    };
  }
  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const r = resize.current;
    const parent = ref.current?.parentElement;
    if (!r || !parent) return;
    const bounds = parent.getBoundingClientRect();
    const next = resizeWindowRect(
      { x: r.left, y: r.top, w: r.w, h: r.h },
      { x: event.clientX - r.x, y: event.clientY - r.y },
      r.edge,
      bounds,
      { width: MIN_W, height: MIN_H },
    );
    // Keep refs in sync with the last pointer event so releasing immediately persists the exact size.
    positionRef.current = { x: next.x, y: next.y };
    sizeRef.current = { w: next.w, h: next.h };
    setPosition(positionRef.current);
    setSize(sizeRef.current);
  }
  function endResize() {
    if (!resize.current) return;
    resize.current = null;
    try {
      localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current));
      if (positionRef.current) localStorage.setItem(key, JSON.stringify(positionRef.current));
    } catch { /* optional storage */ }
  }
  const style = {
    "--window-x": position ? `${position.x}px` : undefined,
    "--window-y": position ? `${position.y}px` : undefined,
    "--window-w": size ? `${size.w}px` : undefined,
    "--window-h": size ? `${size.h}px` : undefined,
    zIndex: front,
  } as CSSProperties;
  return <section ref={ref} aria-label={title} hidden={!open} style={style}
    className={cn("workspace-window", `window-${id}`, className, size && "window-sized", expanded && "window-expanded")}
    onPointerDownCapture={() => setFront(++windowStack)}>
    <div className="window-titlebar" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span className="window-title">{icon}{title}</span>
      <GripHorizontal className="window-grip size-4" aria-hidden />
      <div className="window-actions">
        <Button variant="ghost" size="icon" title={expanded ? `Restore ${title}` : `Maximize ${title}`} aria-label={expanded ? `Restore ${title}` : `Maximize ${title}`} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 /> : <Maximize2 />}</Button>
        <Button variant="ghost" size="icon" title={`Hide ${title}`} aria-label={`Hide ${title}`} onClick={onClose}><X /></Button>
      </div>
    </div>
    <div className="window-body">{children}</div>
    {!expanded && <>{(["n", "e", "s", "w", "ne", "se", "sw", "nw"] as const).map((edge) => <div key={edge} className={`window-resize window-resize-${edge}`} aria-hidden
      onPointerDown={beginResize(edge)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />)}</>}
  </section>;
}
