import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { GripHorizontal, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";
import { clampWindowPosition, fitWindowRect, readWindowPosition, resizeWindowRect, snapRect, snapZone, WORKSPACE_LAYOUT_EVENT, type WindowRect, type WindowResizeEdge, type WindowSnap } from "@/lib/workspace";
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
  const [snapped, setSnapped] = useState<WindowSnap | null>(null);
  const [preview, setPreview] = useState<WindowSnap | null>(null);
  const previewRef = useRef<WindowSnap | null>(null);
  const restoreRef = useRef<WindowRect | null>(null);
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
    setPosition(null); setSize(null); setExpanded(false); setSnapped(null); setPreview(null);
    restoreRef.current = null; previewRef.current = null;
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
  // Every window listens for a single validated preset/custom-layout event. Hidden windows
  // remain mounted, so they receive their geometry before being opened.
  useEffect(() => {
    const apply = (event: Event) => {
      const rect = (event as CustomEvent<{ windows: Record<string, WindowRect> }>).detail?.windows?.[id];
      if (!rect) return;
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const fitted = fitWindowRect(rect, parent.getBoundingClientRect());
      positionRef.current = { x: fitted.x, y: fitted.y };
      sizeRef.current = { w: fitted.w, h: fitted.h };
      setPosition(positionRef.current); setSize(sizeRef.current);
      setExpanded(false); setSnapped(null); setPreview(null);
      restoreRef.current = null;
      try {
        localStorage.setItem(key, JSON.stringify(positionRef.current));
        localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current));
      } catch { /* browser storage is optional */ }
    };
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, apply);
    return () => window.removeEventListener(WORKSPACE_LAYOUT_EVENT, apply);
  }, [id, key, sizeKey]);
  const isMobile = () => window.matchMedia("(max-width: 700px)").matches;
  function begin(event: PointerEvent<HTMLDivElement>) {
    if (expanded || event.button !== 0 || (event.target as HTMLElement).closest("button") || isMobile()) return;
    const element = ref.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const rect = element.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    let x = rect.left - bounds.left, y = rect.top - bounds.top;
    if (snapped && restoreRef.current) {
      // Undock under the cursor and return to the original size when dragging.
      const previous = fitWindowRect(restoreRef.current, bounds);
      x = Math.max(0, Math.min(bounds.width - previous.w, event.clientX - bounds.left - previous.w / 2));
      y = Math.max(0, Math.min(bounds.height - previous.h, event.clientY - bounds.top - 18));
      positionRef.current = { x, y }; sizeRef.current = { w: previous.w, h: previous.h };
      setPosition(positionRef.current); setSize(sizeRef.current);
    }
    setSnapped(null);
    drag.current = { x: event.clientX, y: event.clientY, originX: x, originY: y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    const element = ref.current;
    const parent = element?.parentElement;
    if (!active || !element || !parent) return;
    const bounds = parent.getBoundingClientRect();
    positionRef.current = clampWindowPosition({ x: active.originX + event.clientX - active.x, y: active.originY + event.clientY - active.y }, bounds, element.getBoundingClientRect());
    setPosition(positionRef.current);
    const zone = snapZone({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds);
    previewRef.current = zone;
    setPreview(zone);
  }
  function end(commitSnap = true) {
    if (!drag.current) return;
    drag.current = null;
    const zone = commitSnap ? previewRef.current : null;
    previewRef.current = null; setPreview(null);
    if (zone) {
      const element = ref.current, parent = element?.parentElement;
      if (element && parent) {
        const bounds = parent.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        restoreRef.current = { x: positionRef.current?.x ?? rect.left - bounds.left, y: positionRef.current?.y ?? rect.top - bounds.top, w: rect.width, h: rect.height };
        const next = snapRect(zone, bounds);
        positionRef.current = { x: next.x, y: next.y }; sizeRef.current = { w: next.w, h: next.h };
        setPosition(positionRef.current); setSize(sizeRef.current); setSnapped(zone);
        try { localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current)); } catch { /* optional storage */ }
      }
    }
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
      setSnapped(null);
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
    data-window-id={id}
    className={cn("workspace-window", `window-${id}`, className, size && "window-sized", expanded && "window-expanded")}
    onPointerDownCapture={() => setFront(++windowStack)}>
    <div className="window-titlebar" onPointerDown={begin} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(false)}>
      <span className="window-title">{icon}{title}</span>
      <GripHorizontal className="window-grip size-4" aria-hidden />
      <div className="window-actions">
        <Button variant="ghost" size="icon" title={expanded || snapped ? `Restore ${title}` : `Maximize ${title}`} aria-label={expanded || snapped ? `Restore ${title}` : `Maximize ${title}`} onClick={() => {
          if (snapped && restoreRef.current) {
            const next = restoreRef.current;
            positionRef.current = { x: next.x, y: next.y }; sizeRef.current = { w: next.w, h: next.h };
            setPosition(positionRef.current); setSize(sizeRef.current); setSnapped(null);
            try { localStorage.setItem(key, JSON.stringify(positionRef.current)); localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current)); } catch { /* optional */ }
          } else setExpanded((value) => !value);
        }}>{expanded || snapped ? <Minimize2 /> : <Maximize2 />}</Button>
        <Button variant="ghost" size="icon" title={`Hide ${title}`} aria-label={`Hide ${title}`} onClick={onClose}><X /></Button>
      </div>
    </div>
    <div className="window-body">{children}</div>
    {preview && drag.current && typeof document !== "undefined" && ref.current?.parentElement && createPortal((() => {
      const bounds = ref.current!.parentElement!.getBoundingClientRect();
      const area = snapRect(preview, bounds);
      return <div className="window-snap-preview" aria-hidden style={{ left: bounds.left + area.x, top: bounds.top + area.y, width: area.w, height: area.h }} />;
    })(), document.body)}
    {!expanded && <>{(["n", "e", "s", "w", "ne", "se", "sw", "nw"] as const).map((edge) => <div key={edge} className={`window-resize window-resize-${edge}`} aria-hidden
      onPointerDown={beginResize(edge)} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />)}</>}
  </section>;
}
