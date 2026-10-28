export type WindowPosition = { x: number; y: number };

/** Keep the full window inside its canvas, even after resizing the browser. */
export function clampWindowPosition(position: WindowPosition, bounds: { width: number; height: number }, window: { width: number; height: number }): WindowPosition {
  return {
    x: Math.max(0, Math.min(position.x, Math.max(0, bounds.width - window.width))),
    y: Math.max(0, Math.min(position.y, Math.max(0, bounds.height - window.height))),
  };
}

export function readWindowPosition(value: string | null): WindowPosition | null {
  try {
    const parsed = JSON.parse(value ?? "null");
    return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y) ? { x: parsed.x, y: parsed.y } : null;
  } catch { return null; }
}
/** All four window borders and four corners, including left/top anchored resizing. */
export type WindowResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type WindowRect = { x: number; y: number; w: number; h: number };

/**
 * Resize relative to the original pointer-down geometry, not the previous frame.
 * West/north handles move the origin and preserve the opposite edge.
 * Stay inside the canvas; when the canvas is smaller than the usual minimum,
 * the canvas size wins so the window doesn't overflow.
 */
export function resizeWindowRect(
  start: WindowRect,
  delta: { x: number; y: number },
  edge: WindowResizeEdge,
  bounds: { width: number; height: number },
  minimum: { width: number; height: number } = { width: 320, height: 220 },
): WindowRect {
  const cw = Math.max(0, bounds.width);
  const ch = Math.max(0, bounds.height);
  const minW = Math.min(minimum.width, cw);
  const minH = Math.min(minimum.height, ch);
  const originalRight = Math.min(cw, Math.max(0, start.x + start.w));
  const originalBottom = Math.min(ch, Math.max(0, start.y + start.h));
  let x = Math.max(0, Math.min(start.x, cw));
  let y = Math.max(0, Math.min(start.y, ch));
  let w = Math.max(0, Math.min(start.w, cw - x));
  let h = Math.max(0, Math.min(start.h, ch - y));

  if (edge.includes("w")) {
    const left = Math.max(0, Math.min(originalRight - Math.min(minW, originalRight), start.x + delta.x));
    x = left;
    w = originalRight - left;
  } else if (edge.includes("e")) {
    w = Math.max(Math.min(minW, cw - x), Math.min(cw - x, start.w + delta.x));
  }
  if (edge.includes("n")) {
    const top = Math.max(0, Math.min(originalBottom - Math.min(minH, originalBottom), start.y + delta.y));
    y = top;
    h = originalBottom - top;
  } else if (edge.includes("s")) {
    h = Math.max(Math.min(minH, ch - y), Math.min(ch - y, start.h + delta.y));
  }

  return { x, y, w, h };
}

/** Edge docking is based on pointer position inside the canvas (not the window bounds). */
export type WindowSnap = "left" | "right" | "top";
export const WORKSPACE_LAYOUT_EVENT = "pixel-pals:apply-layout-v1";
export type WorkspaceLayout = { windows: Record<string, WindowRect>; canvas: { width: number; height: number } };
export type WorkspacePreset = "chat" | "mail" | "work" | "server";

export function snapZone(pointer: { x: number; y: number }, bounds: { width: number; height: number }, threshold = 28): WindowSnap | null {
  if (bounds.width <= 0 || bounds.height <= 0 || pointer.x < 0 || pointer.y < 0 || pointer.x > bounds.width || pointer.y > bounds.height) return null;
  // Top wins in the corners; the other two zones split the desktop into halves.
  if (pointer.y <= threshold) return "top";
  if (pointer.x <= threshold) return "left";
  if (pointer.x >= bounds.width - threshold) return "right";
  return null;
}
export function snapRect(zone: WindowSnap, bounds: { width: number; height: number }): WindowRect {
  const w = Math.max(0, bounds.width);
  const h = Math.max(0, bounds.height);
  const left = Math.floor(w / 2);
  if (zone === "left") return { x: 0, y: 0, w: left, h };
  if (zone === "right") return { x: left, y: 0, w: w - left, h };
  return { x: 0, y: 0, w, h };
}

/** Clamp saved or preset coordinates after screen resizing so the window can always be reached. */
export function fitWindowRect(rect: WindowRect, bounds: { width: number; height: number }): WindowRect {
  const cw = Math.max(0, bounds.width);
  const ch = Math.max(0, bounds.height);
  const w = Math.max(0, Math.min(cw, rect.w));
  const h = Math.max(0, Math.min(ch, rect.h));
  const x = Math.max(0, Math.min(cw - w, rect.x));
  const y = Math.max(0, Math.min(ch - h, rect.y));
  return { x, y, w, h };
}

/** Ready-made window arrangements (all values derive from the live canvas size). */
export function presetWindowRects(preset: WorkspacePreset, bounds: { width: number; height: number }): Record<string, WindowRect> {
  const w = Math.max(0, bounds.width), h = Math.max(0, bounds.height);
  const half = Math.floor(w / 2);
  const first = { x: 0, y: 0, w: half, h };
  const second = { x: half, y: 0, w: w - half, h };
  const full = { x: 0, y: 0, w, h };
  if (preset === "chat") return w >= 700 ? { room: first, "mode-roundtable": second } : { room: full, "mode-roundtable": full };
  if (preset === "mail") return { mail: full };
  if (preset === "work") return w >= 700 ? { tools: first, documents: second } : { tools: full, documents: full };
  return w >= 700 ? { today: first, setup: second } : { today: full, setup: full };
}

/** Explicitly reject malformed/untrusted localStorage data before applying it to windows. */
export function readWorkspaceLayout(raw: string | null): WorkspaceLayout | null {
  if (!raw || raw.length > 40_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const o = value as Partial<WorkspaceLayout>;
    if (!o.canvas || !Number.isFinite(o.canvas.width) || !Number.isFinite(o.canvas.height) || o.canvas.width <= 0 || o.canvas.height <= 0) return null;
    if (!o.windows || typeof o.windows !== "object" || Object.keys(o.windows).length > 30) return null;
    const windows: Record<string, WindowRect> = {};
    for (const [id, rect] of Object.entries(o.windows)) {
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) return null;
      windows[id] = rect;
    }
    return Object.keys(windows).length ? { windows, canvas: o.canvas } : null;
  } catch { return null; }
}

export function scaleWorkspaceLayout(layout: WorkspaceLayout, bounds: { width: number; height: number }): Record<string, WindowRect> {
  const scaleX = bounds.width / layout.canvas.width, scaleY = bounds.height / layout.canvas.height;
  return Object.fromEntries(Object.entries(layout.windows).map(([id, rect]) => [id, fitWindowRect({
    x: rect.x * scaleX, y: rect.y * scaleY, w: rect.w * scaleX, h: rect.h * scaleY,
  }, bounds)]));
}
