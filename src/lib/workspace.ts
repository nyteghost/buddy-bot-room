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