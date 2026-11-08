import type { Heading } from "./office-motion";

/**
 * SYNTHETIC placeholder bodies for the Living Universe HD preview — drawn in code, clearly labelled, never
 * presented as a Pal's real artwork. They show how a detailed 256×256 character reads at HD scale until the
 * Character Designer's approved art exists. Smooth shading, eight facings, a distance-driven walk cycle.
 */
export type SyntheticPalette = Readonly<{ skin: string; hair: string; jacket: string; trim: string; pants: string; shoe: string; phones?: boolean }>;
export const SYNTHETIC_PALETTES: Readonly<Record<string, SyntheticPalette>> = {
 nova: { skin: "#f1c7a3", hair: "#5b3df5", jacket: "#7b3fe4", trim: "#29d3f0", pants: "#25283a", shoe: "#e8e8f0", phones: true },
 byte: { skin: "#c98b62", hair: "#1d1b22", jacket: "#2d6cdf", trim: "#9fe3ff", pants: "#2c3548", shoe: "#2a2a2a" },
 sage: { skin: "#8d5a3b", hair: "#e9e1d4", jacket: "#2f9e6f", trim: "#c8f169", pants: "#3b2f28", shoe: "#c9a46b" },
 pip: { skin: "#f6d8c2", hair: "#d26a1e", jacket: "#e8b62f", trim: "#ffffff", pants: "#1e2433", shoe: "#d33" },
 echo: { skin: "#e6b48f", hair: "#3a2a1c", jacket: "#e75fae", trim: "#ffe3f1", pants: "#4b4f63", shoe: "#222" },
 rune: { skin: "#b07a54", hair: "#8a1c4a", jacket: "#5a3a8a", trim: "#f6c445", pants: "#2a2238", shoe: "#f5f5f5" },
 claude: { skin: "#f0c9a8", hair: "#6b4a2b", jacket: "#d9773c", trim: "#fbe3c9", pants: "#3a3030", shoe: "#2a2a2a" },
 saiyan: { skin: "#f3c79c", hair: "#111111", jacket: "#e2513b", trim: "#2f5bd8", pants: "#2f5bd8", shoe: "#c63b2b" },
 mimic: { skin: "#d8b48c", hair: "#5b3a24", jacket: "#8b5e3c", trim: "#f6c445", pants: "#3e2716", shoe: "#2a1a10" },
};
const fallback: SyntheticPalette = { skin: "#e6b48f", hair: "#3a2a1c", jacket: "#5c7cfa", trim: "#ffffff", pants: "#2a2f40", shoe: "#222" };
export const syntheticPalette = (id: string): SyntheticPalette => SYNTHETIC_PALETTES[id] ?? fallback;

const YAW: Record<Heading, number> = { s: 0, se: 45, e: 90, ne: 135, n: 180, nw: -135, w: -90, sw: -45 };
export type SyntheticPose = Readonly<{ facing: Heading; phase: number; walking: boolean; breath: number; motion?: string }>;

export function shade(hex: string, amount: number): string {
 const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
 const ch = (shift: number) => { const c = (n >> shift) & 255; return Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount)))); };
 return "#" + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, "0")).join("");
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
 ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
 ctx.beginPath();
 for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
 ctx.closePath(); ctx.fill();
}
/** Draw one synthetic 256×256 frame (feet on row 247) into `ctx`. */
export function drawSyntheticCharacter(ctx: CanvasRenderingContext2D, c: SyntheticPalette, pose: SyntheticPose): void {
 ctx.clearRect(0, 0, 256, 256);
 ctx.save();
 let yaw = YAW[pose.facing] ?? 0;
 if (yaw < 0) { ctx.translate(256, 0); ctx.scale(-1, 1); yaw = -yaw; }
 const rad = yaw * Math.PI / 180, side = Math.sin(rad), front = Math.cos(rad);
 const swing = pose.walking ? Math.sin(pose.phase * Math.PI * 2) : 0;
 const bob = pose.walking ? -Math.abs(Math.sin(pose.phase * Math.PI * 2)) * 5 : pose.breath * 1.4;
 const sitting = pose.motion === "rest";
 const ink = "rgba(18,12,22,.85)";
 const sh = ctx.createRadialGradient(128, 246, 4, 128, 246, 44); sh.addColorStop(0, "rgba(0,0,0,.42)"); sh.addColorStop(1, "rgba(0,0,0,0)");
 ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(128, 246, 46, 9, 0, 0, Math.PI * 2); ctx.fill();
 const drop = sitting ? 26 : 0;
 const hipY = 160 + bob + drop, torsoW = 80 - side * 30, shoulderY = 94 + bob + drop;
 const limb = (x1: number, y1: number, x2: number, y2: number, w: number, color: string) => {
  ctx.lineCap = "round"; ctx.strokeStyle = ink; ctx.lineWidth = w + 5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
 };
 const leg = (sign: number) => {
  const hx = 128 + sign * (16 - side * 12) + side * 4, ang = side * sign * swing * 0.5, lift = (1 - side) * Math.max(0, sign * swing) * 12;
  const fx = sitting ? hx + (side > 0.4 ? 30 : 0) : hx + Math.sin(ang) * 78, fy = sitting ? 240 : Math.min(240, hipY + Math.cos(ang) * 80 - lift);
  if (sitting) { limb(hx, hipY, hx + (side > 0.4 ? 34 : 0), hipY + 6, 24, c.pants); limb(hx + (side > 0.4 ? 34 : 0), hipY + 6, fx, fy, 22, c.pants); }
  else limb(hx, hipY, fx, fy, 24, c.pants);
  ctx.fillStyle = c.shoe; ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(fx + side * 8, fy + 4, 15 + side * 6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
 };
 const arm = (sign: number) => {
  const sx = 128 + sign * (torsoW / 2 - 2) * (1 - side * 0.55) + side * 6;
  const raise = pose.motion === "wave" && sign > 0 ? -2.4 : pose.motion === "stretch" ? -2.9 * sign : 0;
  const ang = raise || -sign * swing * (0.35 + side * 0.25);
  const hx = sx + Math.sin(ang) * 64 + sign * (1 - side) * 6, hy = shoulderY + Math.cos(ang) * 64;
  limb(sx, shoulderY + 6, hx, hy, 18, c.jacket);
  ctx.fillStyle = c.skin; ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy + 4, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
 };
 const far = front >= 0 ? -1 : 1;
 leg(far); if (side > 0.3) arm(far);
 leg(-far);
 const tg = ctx.createLinearGradient(0, shoulderY, 0, hipY + 8); tg.addColorStop(0, c.jacket); tg.addColorStop(1, shade(c.jacket, -0.28));
 ctx.fillStyle = tg; ctx.strokeStyle = ink; ctx.lineWidth = 5;
 roundRect(ctx, 128 - torsoW / 2, shoulderY - 6, torsoW, hipY - shoulderY + 14, 22); ctx.fill(); ctx.stroke();
 if (front > 0.25) {
  ctx.fillStyle = c.trim; roundRect(ctx, 128 - 8 + side * 14, shoulderY, 16, hipY - shoulderY, 6); ctx.fill();
  ctx.fillStyle = "#ffd84a"; star(ctx, 128 - 22 + side * 8, shoulderY + 30, 7);
 } else if (front < -0.25) { ctx.strokeStyle = shade(c.jacket, -0.35); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(128, shoulderY + 4); ctx.lineTo(128, hipY); ctx.stroke(); }
 if (side <= 0.3) { arm(-1); arm(1); } else arm(-far);
 const headY = 54 + bob + drop;
 limb(128 + side * 4, shoulderY - 8, 128 + side * 4, headY + 24, 20, c.skin);
 const hg = ctx.createRadialGradient(118 + side * 10, headY - 12, 6, 128, headY, 40); hg.addColorStop(0, shade(c.skin, 0.12)); hg.addColorStop(1, shade(c.skin, -0.12));
 ctx.fillStyle = hg; ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(128 + side * 6, headY, 34 - side * 4, 37, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
 if (front > -0.2) {
  const ex = 128 + side * 18;
  ctx.fillStyle = "#1c1424";
  if (side < 0.75) { ctx.beginPath(); ctx.ellipse(ex - 12 * (1 - side * 0.6), headY + 2, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(ex + 12 * (1 - side * 0.6), headY + 2, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = shade(c.skin, -0.45); ctx.lineWidth = 3; ctx.beginPath();
  if (pose.motion === "talk") ctx.ellipse(ex + side * 4, headY + 19, 5, 4, 0, 0, Math.PI * 2); else ctx.arc(ex + side * 4, headY + 18, 7, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
 }
 ctx.fillStyle = c.hair; ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.beginPath();
 if (front < -0.2) ctx.ellipse(128 + side * 6, headY - 2, 36 - side * 3, 39, 0, 0, Math.PI * 2); // from behind: the whole head is hair
 else ctx.ellipse(128 + side * 2, headY - 14, 38, 28, 0, Math.PI * 0.92, Math.PI * 2.08);
 ctx.closePath(); ctx.fill(); ctx.stroke();
 for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(128 + k * 14 + side * 6, headY - 34); ctx.lineTo(128 + k * 14 + 9 + side * 10, headY - 52 + Math.abs(k) * 4); ctx.lineTo(128 + k * 14 + 16 + side * 6, headY - 30); ctx.fill(); }
 if (c.phones) {
  ctx.strokeStyle = c.trim; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(128 + side * 6, headY - 2, 38, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.fillStyle = c.trim; ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(128 + side * 6 + (side > 0.5 ? 0 : -36), headY + 4, 9, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
 }
 ctx.restore();
}
