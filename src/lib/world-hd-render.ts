/**
 * Render-scale rules for HD256 art (owner art direction 2026-11-07: crisp, visible square pixels).
 *
 * HD256 frames are a 256×256 delivery canvas. Pixel-art masters are often drawn on a coarser grid
 * (e.g. 64×64) and enlarged with nearest-neighbour by an integer factor (4×). Such art stays crisp
 * only if every art pixel covers a whole number of *device* pixels on screen; any other size makes
 * nearest-neighbour drop or double pixels unevenly. Painted (non-grid) art has no grid and is scaled
 * smoothly instead, and is labelled as such.
 */
export const WORLD_HD_CANVAS = 256;
const GRIDS = [16, 8, 4, 2] as const;

/**
 * Largest block size (16, 8, 4 or 2) at which every block of the RGBA image is a single colour,
 * i.e. the art was enlarged from a (canvas/block)-pixel master. 1 means painted / not grid-aligned.
 * Fully transparent pixels match each other regardless of their RGB values.
 */
export function worldPixelGrid(data: ArrayLike<number>, width: number, height = width): number {
 if (width <= 0 || height <= 0 || data.length < width * height * 4) return 1;
 const same = (a: number, b: number) => (data[a + 3] === 0 && data[b + 3] === 0) ||
  (data[a] === data[b] && data[a + 1] === data[b + 1] && data[a + 2] === data[b + 2] && data[a + 3] === data[b + 3]);
 for (const block of GRIDS) {
  if (width % block || height % block) continue;
  let uniform = true;
  for (let y = 0; y < height && uniform; y++) for (let x = 0; x < width; x++) {
   const origin = ((y - (y % block)) * width + (x - (x % block))) * 4;
   if (!same((y * width + x) * 4, origin)) { uniform = false; break; }
  }
  if (uniform) return block;
 }
 return 1;
}

/**
 * CSS size (px) for a 256 canvas so each art pixel spans a whole number of device pixels,
 * as close as possible to `target` css px. Painted art (grid 1) keeps the target size.
 */
export function worldHdDisplaySize(target: number, devicePixelRatio: number, grid: number): number {
 const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
 if (!Number.isInteger(grid) || grid < 2) return target;
 const master = WORLD_HD_CANVAS / grid;
 const multiple = Math.max(1, Math.round((target * dpr) / master));
 return Math.round((multiple * master / dpr) * 1000) / 1000;
}

const grids = new Map<string, Promise<number>>();
/** Browser-only: detect (and cache) the pixel grid of one HD frame. Resolves 1 when it cannot decode. */
export function worldHdFrameGrid(src: string): Promise<number> {
 let found = grids.get(src);
 if (found) return found;
 found = new Promise<number>(resolve => {
  if (typeof Image === "undefined" || typeof document === "undefined") { resolve(1); return; }
  const image = new Image();
  image.onload = () => {
   try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) { resolve(1); return; }
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0);
    resolve(worldPixelGrid(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
   } catch { resolve(1); }
  };
  image.onerror = () => resolve(1);
  image.src = src;
 });
 if (grids.size > 200) grids.clear();
 grids.set(src, found);
 return found;
}
