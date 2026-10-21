// Browser-only PDF side of the Floor map tool: read the plan's text and lines with pdf.js, draw the colours, export PNG / PDF.
import { COLORS, drawFor, type Box, type Placed, type Prims, type Seg, type TextBit } from "./floor-map";

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

export type PlanDoc = { prims: Prims; render: (canvas: HTMLCanvasElement, scale: number) => Promise<void> };

/** Page 1 of a floor plan: its text, the lines it is drawn with, and a way to paint it on a canvas. */
export async function readPlan(file: File, pageNo = 1): Promise<PlanDoc> {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(Math.min(pageNo, pdf.numPages));
  const vp = page.getViewport({ scale: 1 });
  const V = vp.transform as Mat;

  const texts: TextBit[] = [];
  const content = await page.getTextContent();
  for (const it of content.items as { str?: string; transform?: number[]; width?: number }[]) {
    if (!it.str?.trim() || !it.transform) continue;
    const t = mul(V, it.transform as Mat);
    const len = Math.hypot(t[0], t[1]) || 1;
    const hgt = Math.hypot(t[2], t[3]) || 1;
    const w = (it.width ?? 0) * vp.scale;
    const dx = t[0] / len, dy = t[1] / len; // along the text
    const ux = t[2] / hgt, uy = t[3] / hgt; // up the glyphs (y flips under the viewport)
    const pts = [[t[4], t[5]], [t[4] + dx * w, t[5] + dy * w], [t[4] + ux * hgt * 0.75, t[5] + uy * hgt * 0.75], [t[4] + dx * w + ux * hgt * 0.75, t[5] + dy * w + uy * hgt * 0.75]];
    const xs = pts.map((p) => p[0]!), ys = pts.map((p) => p[1]!);
    texts.push({ s: it.str, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }

  const segs: Seg[] = [];
  const boxes: Box[] = [];
  const { OPS } = lib;
  const ops = await page.getOperatorList();
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: Mat[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push([...ctm] as Mat);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as Mat);
    else if (fn === OPS.constructPath) {
      const pathOps = args[0] as ArrayLike<number>;
      const c = args[1] as ArrayLike<number>;
      const M = mul(V, ctm);
      let ci = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      const pts: [number, number][] = [];
      const flush = () => {
        if (pts.length === 4 || (pts.length === 5 && pts[0]![0] === pts[4]![0] && pts[0]![1] === pts[4]![1])) {
          const xs = pts.slice(0, 4).map((p) => p[0]), ys = pts.slice(0, 4).map((p) => p[1]);
          const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
          if (pts.slice(0, 4).every((p) => xs.some((x) => Math.abs(x - p[0]) < 0.05) && ys.some((y) => Math.abs(y - p[1]) < 0.05)) && w > 0 && h > 0) boxes.push({ x: Math.min(...xs), y: Math.min(...ys), w, h });
        }
        pts.length = 0;
      };
      for (let k = 0; k < pathOps.length; k++) {
        const op = pathOps[k]!;
        if (op === OPS.moveTo) { flush(); [cx, cy] = apply(M, c[ci]!, c[ci + 1]!); sx = cx; sy = cy; ci += 2; pts.push([cx, cy]); }
        else if (op === OPS.lineTo) { const [nx, ny] = apply(M, c[ci]!, c[ci + 1]!); ci += 2; segs.push({ x1: cx, y1: cy, x2: nx, y2: ny }); cx = nx; cy = ny; pts.push([cx, cy]); }
        else if (op === OPS.curveTo) { [cx, cy] = apply(M, c[ci + 4]!, c[ci + 5]!); ci += 6; pts.push([cx, cy]); pts.push([cx, cy]); pts.push([cx, cy]); }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { [cx, cy] = apply(M, c[ci + 2]!, c[ci + 3]!); ci += 4; pts.push([cx, cy]); pts.push([cx, cy]); pts.push([cx, cy]); }
        else if (op === OPS.closePath) { if (cx !== sx || cy !== sy) segs.push({ x1: cx, y1: cy, x2: sx, y2: sy }); pts.push([sx, sy]); cx = sx; cy = sy; }
        else if (op === OPS.rectangle) {
          flush();
          const x = c[ci]!, y = c[ci + 1]!, w = c[ci + 2]!, h = c[ci + 3]!; ci += 4;
          const p1 = apply(M, x, y), p2 = apply(M, x + w, y), p3 = apply(M, x + w, y + h), p4 = apply(M, x, y + h);
          segs.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }, { x1: p2[0], y1: p2[1], x2: p3[0], y2: p3[1] }, { x1: p3[0], y1: p3[1], x2: p4[0], y2: p4[1] }, { x1: p4[0], y1: p4[1], x2: p1[0], y2: p1[1] });
          const xs = [p1[0], p2[0], p3[0], p4[0]], ys = [p1[1], p2[1], p3[1], p4[1]];
          const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
          if (bw > 0 && bh > 0) boxes.push({ x: Math.min(...xs), y: Math.min(...ys), w: bw, h: bh });
        }
      }
      flush();
    }
  }
  return {
    prims: { width: vp.width, height: vp.height, texts, segs, boxes },
    render: async (canvas, scale) => {
      const v = page.getViewport({ scale });
      canvas.width = Math.ceil(v.width); canvas.height = Math.ceil(v.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: v }).promise;
    },
  };
}

/** The "Better Work Order Items" report as lines of text, left to right. */
export async function readWorkOrder(file: File): Promise<string[]> {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows: { y: number; items: { x: number; s: string }[] }[] = [];
    for (const it of content.items as { str?: string; transform?: number[] }[]) {
      if (!it.str?.trim() || !it.transform) continue;
      const y = it.transform[5] ?? 0;
      const row = rows.find((r) => Math.abs(r.y - y) <= 2) ?? (rows.push({ y, items: [] }), rows[rows.length - 1]!);
      row.items.push({ x: it.transform[4] ?? 0, s: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" "));
  }
  return lines;
}

// ---------------------------------------------------------------- drawing

export type Pending = Box[];

/** Paint the colours onto a canvas that already holds the plan; `s` = pixels per PDF point. `oy` = pixels of header above the plan. */
export function drawOverlay(ctx: CanvasRenderingContext2D, s: number, placed: Placed[], pending: Pending = [], oy = 0) {
  ctx.save();
  ctx.translate(0, oy);
  for (const pl of placed) {
    const d = drawFor(pl);
    for (const c of d.cells) {
      const x = c.x * s, y = c.y * s, w = c.w * s, h = c.h * s;
      if (d.fill === "yo") {
        ctx.fillStyle = COLORS.y;
        if (w >= h) { ctx.fillRect(x, y, w, h / 2); ctx.fillStyle = COLORS.o; ctx.fillRect(x, y + h / 2, w, h / 2); } else { ctx.fillRect(x, y, w / 2, h); ctx.fillStyle = COLORS.o; ctx.fillRect(x + w / 2, y, w / 2, h); }
      } else if (d.fill) { ctx.fillStyle = d.fill === "y" ? COLORS.y : COLORS.o; ctx.fillRect(x, y, w, h); }
      ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(1, 0.5 * s); ctx.strokeRect(x, y, w, h);
      const q = Math.max(3 * s, Math.min(w, h) * 0.3);
      d.squares.forEach((sq, i) => { ctx.fillStyle = COLORS[sq]; ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, 0.4 * s); ctx.fillRect(x + 1 + i * (q + 1), y + 1, q, q); ctx.strokeRect(x + 1 + i * (q + 1), y + 1, q, q); });
    }
    if (d.tag.length) {
      const xs = d.cells.flatMap((c) => [c.x, c.x + c.w]), ys = d.cells.flatMap((c) => [c.y, c.y + c.h]);
      const cx = ((Math.min(...xs) + Math.max(...xs)) / 2) * s, cy = ((Math.min(...ys) + Math.max(...ys)) / 2) * s;
      const cellMin = Math.min(...d.cells.map((c) => Math.min(c.w, c.h))) * s;
      const fs = Math.max(8, Math.min(cellMin * 0.55, 7 * s));
      ctx.font = `bold ${fs}px Helvetica, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const lh = fs * 1.15, wmax = Math.max(...d.tag.map((t) => ctx.measureText(t).width));
      const top = cy - (d.tag.length * lh) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = d.tagColor === "o" ? COLORS.ot : d.tagColor === "y" ? COLORS.yt : "#444"; ctx.lineWidth = Math.max(1, 0.4 * s);
      const rx = cx - wmax / 2 - fs * 0.3, ry = top - fs * 0.15, rw = wmax + fs * 0.6, rh = d.tag.length * lh + fs * 0.3;
      ctx.beginPath(); ctx.roundRect(rx, ry, rw, rh, fs * 0.25); ctx.fill(); ctx.stroke();
      d.tag.forEach((t, i) => { ctx.fillStyle = /^SCase/.test(t) || /^x/.test(t) ? (d.tagColor === "o" ? COLORS.ot : COLORS.yt) : "#000"; ctx.fillText(t, cx, top + lh * (i + 0.5)); });
    }
  }
  for (const c of pending) {
    ctx.strokeStyle = "#1a59f2"; ctx.lineWidth = Math.max(2, 1.2 * s); ctx.setLineDash([4 * s, 3 * s]);
    ctx.strokeRect(c.x * s, c.y * s, c.w * s, c.h * s); ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Legend strip drawn above the plan so it never covers a booth. Returns its height in pixels. */
export function drawLegend(ctx: CanvasRenderingContext2D, widthPx: number, s: number, title: string): number {
  const fs = Math.max(14, 6.5 * s);
  const h = fs * 4.6;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, widthPx, h);
  ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, widthPx - 2, h - 2);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = "#000"; ctx.font = `bold ${fs * 1.1}px Helvetica, Arial, sans-serif`;
  ctx.fillText(title, fs, fs * 1.1);
  ctx.font = `${fs}px Helvetica, Arial, sans-serif`;
  let x = fs;
  const y = fs * 2.7, sw = fs * 1.6;
  const item = (label: string, paint: (x: number) => void) => { paint(x); ctx.fillStyle = "#000"; ctx.fillText(label, x + sw + fs * 0.4, y); x += sw + fs * 0.4 + ctx.measureText(label).width + fs * 1.4; };
  const box = (col: string) => (px: number) => { ctx.fillStyle = col; ctx.fillRect(px, y - fs * 0.5, sw, fs); ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(px, y - fs * 0.5, sw, fs); };
  item("10 amp / showcase", box(COLORS.y));
  item("20 amp", box(COLORS.o));
  item("Both", (px) => { ctx.fillStyle = COLORS.y; ctx.fillRect(px, y - fs * 0.5, sw, fs / 2); ctx.fillStyle = COLORS.o; ctx.fillRect(px, y, sw, fs / 2); ctx.strokeStyle = "#000"; ctx.strokeRect(px, y - fs * 0.5, sw, fs); });
  const sq = (c: string) => (px: number) => { ctx.fillStyle = c; ctx.fillRect(px + sw * 0.25, y - fs * 0.3, fs * 0.6, fs * 0.6); };
  item("30 amp", sq(COLORS.red)); item("60 amp", sq(COLORS.green)); item("Water", sq(COLORS.blue)); item("Air", sq(COLORS.purple));
  ctx.font = `${fs * 0.85}px Helvetica, Arial, sans-serif`; ctx.fillStyle = "#000";
  ctx.fillText("x# = number ordered (if more than 1)   SCase xN = showcases   A / B xN = track lights", fs, fs * 3.9);
  return h;
}

// ---------------------------------------------------------------- export

export function canvasToPngBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the image"))), "image/png"));
}

/** One JPEG on one PDF page — enough to print or email the coloured plan. */
export async function canvasToPdfBlob(c: HTMLCanvasElement): Promise<Blob> {
  const jpeg = new Uint8Array(await (await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("No image"))), "image/jpeg", 0.92))).arrayBuffer());
  const W = c.width, H = c.height;
  const pw = 792, ph = Math.round((792 * H) / W);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (u: Uint8Array) => { parts.push(u); len += u.length; };
  const text = (s: string) => push(enc.encode(s));
  const obj = (n: number, body: string | Uint8Array[]) => {
    offsets[n] = len;
    text(`${n} 0 obj\n`);
    if (typeof body === "string") text(body); else body.forEach(push);
    text("\nendobj\n");
  };
  text("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [enc.encode(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, enc.encode("\nendstream")]);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  text(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return new Blob([out], { type: "application/pdf" });
}

/** Pixels per point so the picture is sharp but a phone can still hold it. */
export const pickScale = (p: Prims) => Math.max(0.8, Math.min(3, Math.sqrt(14_000_000 / (p.width * p.height)), 4600 / Math.max(p.width, p.height)));
