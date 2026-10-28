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
