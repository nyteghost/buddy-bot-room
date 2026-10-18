import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { GripHorizontal, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampWindowPosition, readWindowPosition } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export function WorkspaceWindow({ id, title, icon, open, onClose, children, resetVersion }: {
  id: string; title: string; icon: ReactNode; open: boolean; onClose: () => void;
  children: ReactNode; resetVersion: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [front, setFront] = useState(1);
  const positionRef = useRef(position);
  positionRef.current = position;
  const key = `pixel-pals-window-${id}-v1`;
  useEffect(() => {
    if (open) setFront(Date.now());
  }, [open]);
  useEffect(() => {
    try { setPosition(readWindowPosition(localStorage.getItem(key))); } catch { /* optional browser storage */ }
  }, [key]);
  useEffect(() => {
    if (!resetVersion) return;
    setPosition(null); setExpanded(false);
    try { localStorage.removeItem(key); } catch { /* optional storage */ }
  }, [resetVersion, key]);
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
  function begin(event: PointerEvent<HTMLDivElement>) {
    if (expanded || event.button !== 0 || (event.target as HTMLElement).closest("button") || window.matchMedia("(max-width: 700px)").matches) return;
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
  const style = { "--window-x": position ? `${position.x}px` : undefined, "--window-y": position ? `${position.y}px` : undefined, zIndex: front } as CSSProperties;
  return <section ref={ref} aria-label={title} hidden={!open} style={style}
    className={cn("workspace-window", `window-${id}`, expanded && "window-expanded")}
    onPointerDownCapture={() => setFront(Date.now())}>
    <div className="window-titlebar" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span className="window-title">{icon}{title}</span>
      <GripHorizontal className="window-grip size-4" aria-hidden />
      <div className="window-actions">
        <Button variant="ghost" size="icon" title={expanded ? `Restore ${title}` : `Maximize ${title}`} aria-label={expanded ? `Restore ${title}` : `Maximize ${title}`} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 /> : <Maximize2 />}</Button>
        <Button variant="ghost" size="icon" title={`Hide ${title}`} aria-label={`Hide ${title}`} onClick={onClose}><X /></Button>
      </div>
    </div>
    <div className="window-body">{children}</div>
  </section>;
}