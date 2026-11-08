/* Living Universe HD camera lab — placeholder art only. See README.md in this folder. */
(() => {
"use strict";
const floor = __require("world-floor"), wander = __require("world-wander"), crowdLib = __require("world-crowd");
const cam = __require("world-camera"), pres = __require("world-presentation");

// ---- World: a larger virtual room (2752×1600 world px, the app's 1.72 aspect). At zoom 1 one world px = one CSS px.
const W = 2752, H = 1600, WORLD = { width: W, height: H };
// Character = the unit of scale. A 256×256 frame is drawn over ACTOR_PX world px (figure ≈ 0.92 of that).
// MAX_ZOOM keeps painted 256 art at ≤ 1.25 device pixels per art pixel on a 2× screen (never visibly enlarged).
const ACTOR_PX = 192, MAX_ZOOM = 0.85, FIGURE = ACTOR_PX * 0.92;
const params = new URLSearchParams(location.search);
const rect = (x1, y1, x2, y2, label) => ({ x1, y1, x2, y2, label });
const p = (x, y) => ({ x, y });
// Furniture: floor footprint (blocks feet) + how high its drawing rises. Characters with feet above the
// footprint's bottom edge are drawn behind it, so the floor behind furniture is usable (layered occlusion).
const PROPS = [
 { id: "shelf", draw: "shelf", foot: rect(6, 29, 16, 33, "bookshelf"), top: 16 },
 { id: "desk-a", draw: "desk", foot: rect(19, 47, 28, 52, "desk"), top: 45 },
 { id: "desk-b", draw: "desk", foot: rect(37, 47, 46, 52, "desk"), top: 45 },
 { id: "sofa", draw: "sofa", foot: rect(64, 43, 80, 49, "sofa"), top: 39 },
 { id: "coffee", draw: "table", foot: rect(67, 58, 76, 62, "coffee table"), top: 56 },
 { id: "plant-r", draw: "plant", foot: rect(88, 31, 91, 34, "plant"), top: 24 },
 { id: "arcade", draw: "arcade", foot: rect(3, 62, 8, 68, "arcade cabinet"), top: 55 },
 { id: "round", draw: "round", foot: rect(41, 75, 52, 81, "round table"), top: 75.5 },
 { id: "plant-l", draw: "plant", foot: rect(57, 86, 60, 89, "plant"), top: 81 },
];
const fixture = (id, label, kind, glow, stand, facing) => ({ id, label, kind, glow, stand, facing });
const LAB = floor.worldRegisterLabPlan("lab-hd-lounge", {
 bounds: { x1: 2, y1: 31, x2: 97, y2: 96 },
 obstacles: PROPS.map(pr => pr.foot),
 homes: [p(26, 58), p(44, 58), p(72, 54), p(14, 40), p(86, 70), p(30, 88), p(64, 92), p(90, 44), p(12, 82)],
 visits: [p(50, 40), p(28, 40), p(60, 70), p(20, 72), p(80, 84), p(46, 66), p(36, 92), p(92, 58), p(56, 34)],
 fixtures: [
  fixture("desk-a", "desk A", "screen", p(24, 42), p(24, 56), "n"), fixture("desk-b", "desk B", "screen", p(42, 42), p(42, 56), "n"),
  fixture("shelf", "bookshelf", "board", p(13, 20), p(13, 37), "n"), fixture("arcade", "arcade", "screen", p(6, 52), p(12, 66), "w"),
  fixture("round", "round table", "table", p(47, 76), p(47, 86), "n"), fixture("sofa", "sofa", "lamp", p(73, 40), p(73, 53), "n"),
 ],
});
const CAST = [
 { id: "a", name: "Test Pal A", skin: "#f1c7a3", hair: "#5b3df5", jacket: "#7b3fe4", trim: "#29d3f0", pants: "#25283a", shoe: "#e8e8f0", phones: true },
 { id: "b", name: "Test Pal B", skin: "#c98b62", hair: "#1d1b22", jacket: "#e2513b", trim: "#f6c445", pants: "#2c3548", shoe: "#2a2a2a" },
 { id: "c", name: "Test Pal C", skin: "#8d5a3b", hair: "#e9e1d4", jacket: "#2f9e6f", trim: "#c8f169", pants: "#3b2f28", shoe: "#c9a46b" },
 { id: "d", name: "Test Pal D", skin: "#f6d8c2", hair: "#d26a1e", jacket: "#2d6cdf", trim: "#ffffff", pants: "#1e2433", shoe: "#d33" },
 { id: "e", name: "Test Pal E", skin: "#e6b48f", hair: "#3a2a1c", jacket: "#e8b62f", trim: "#40342a", pants: "#4b4f63", shoe: "#222" },
 { id: "f", name: "Test Pal F", skin: "#b07a54", hair: "#8a1c4a", jacket: "#e75fae", trim: "#ffe3f1", pants: "#2a2238", shoe: "#f5f5f5", phones: true },
];

// ---- Environment (vector placeholder art: sharp at every zoom, a few KB instead of a 6000px image)
function envSvg() {
 const wallH = H * 0.3, planks = [];
 for (let y = wallH; y < H; y += 46) planks.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#5a3a24" stroke-opacity=".35" stroke-width="2"/>`);
 for (let i = 0; i < 70; i++) { const y = wallH + (i * 46) % (H - wallH), x = (i * 397) % W; planks.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 46}" stroke="#3e2716" stroke-opacity=".35" stroke-width="2"/>`); }
 const windows = [0.3, 0.52, 0.74].map(f => { const x = W * f - 150; return `<g><rect x="${x}" y="70" width="300" height="300" rx="10" fill="url(#night)" stroke="#3a2a3e" stroke-width="16"/>
  ${Array.from({ length: 7 }, (_, k) => `<rect x="${x + 12 + k * 40}" y="${230 - (k * 37) % 110}" width="28" height="${140 + (k * 37) % 110}" fill="#151a33"/>`).join("")}
  <line x1="${x + 150}" y1="70" x2="${x + 150}" y2="370" stroke="#3a2a3e" stroke-width="10"/></g>`; }).join("");
 return `<svg class="env" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
 <defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2238"/><stop offset="1" stop-color="#3b2f4b"/></linearGradient>
 <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4429"/><stop offset="1" stop-color="#8a5a36"/></linearGradient>
 <linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset="1" stop-color="#3a2a6b"/></linearGradient>
 <radialGradient id="rug"><stop offset="0" stop-color="#5a2d6a"/><stop offset=".8" stop-color="#3d1f4d"/><stop offset="1" stop-color="#2a1536"/></radialGradient>
 <radialGradient id="lamp"><stop offset="0" stop-color="#ffe7a6" stop-opacity=".22"/><stop offset="1" stop-color="#ffe7a6" stop-opacity="0"/></radialGradient></defs>
 <rect width="${W}" height="${wallH}" fill="url(#wall)"/>${windows}
 <rect y="${wallH - 34}" width="${W}" height="34" fill="#20182b"/>
 <rect y="${wallH}" width="${W}" height="${H - wallH}" fill="url(#floor)"/>${planks.join("")}
 <ellipse cx="${W * 0.47}" cy="${H * 0.7}" rx="${W * 0.25}" ry="${H * 0.16}" fill="url(#rug)" opacity=".9"/>
 <ellipse cx="${W * 0.47}" cy="${H * 0.7}" rx="${W * 0.23}" ry="${H * 0.14}" fill="none" stroke="#c9a35a" stroke-opacity=".5" stroke-width="6" stroke-dasharray="18 12"/>
 ${[0.18, 0.5, 0.82].map(f => `<circle cx="${W * f}" cy="${H * 0.45}" r="520" fill="url(#lamp)"/>`).join("")}
 </svg>`;
}
function propSvg(pr) {
 const x = pr.foot.x1 / 100 * W, w = (pr.foot.x2 - pr.foot.x1) / 100 * W, top = pr.top / 100 * H, bottom = pr.foot.y2 / 100 * H, h = bottom - top;
 const shade = (fill, extra = "") => `fill="${fill}" stroke="#120c16" stroke-width="5" stroke-linejoin="round" ${extra}`;
 let body = "";
 switch (pr.draw) {
  case "desk": body = `<rect x="4" y="${h * .28}" width="${w - 8}" height="${h * .18}" rx="8" ${shade("#7a5236")}/>
   <rect x="16" y="${h * .44}" width="22" height="${h * .54}" ${shade("#5b3a24")}/><rect x="${w - 38}" y="${h * .44}" width="22" height="${h * .54}" ${shade("#5b3a24")}/>
   <rect x="${w * .3}" y="${h * .02}" width="${w * .4}" height="${h * .26}" rx="8" ${shade("#1d2433")}/><rect x="${w * .33}" y="${h * .05}" width="${w * .34}" height="${h * .19}" rx="4" fill="#2fd6ff" opacity=".85"/>`; break;
  case "sofa": body = `<rect x="6" y="${h * .05}" width="${w - 12}" height="${h * .5}" rx="40" ${shade("#7d2f4f")}/>
   <rect x="6" y="${h * .45}" width="${w - 12}" height="${h * .35}" rx="26" ${shade("#99406a")}/><rect x="0" y="${h * .3}" width="70" height="${h * .55}" rx="30" ${shade("#7d2f4f")}/>
   <rect x="${w - 70}" y="${h * .3}" width="70" height="${h * .55}" rx="30" ${shade("#7d2f4f")}/><rect x="40" y="${h * .82}" width="22" height="${h * .18}" fill="#2a1a12"/><rect x="${w - 62}" y="${h * .82}" width="22" height="${h * .18}" fill="#2a1a12"/>`; break;
  case "table": body = `<ellipse cx="${w / 2}" cy="${h * .3}" rx="${w / 2 - 6}" ry="${h * .26}" ${shade("#8b5e3c")}/><rect x="${w / 2 - 14}" y="${h * .4}" width="28" height="${h * .6}" ${shade("#5b3a24")}/>
   <circle cx="${w * .35}" cy="${h * .25}" r="16" fill="#f4e7d0"/><circle cx="${w * .62}" cy="${h * .28}" r="12" fill="#e45b5b"/>`; break;
  case "round": body = `<ellipse cx="${w / 2}" cy="${h * .32}" rx="${w / 2 - 6}" ry="${h * .28}" ${shade("#6a4a8a")}/><rect x="${w / 2 - 20}" y="${h * .45}" width="40" height="${h * .55}" ${shade("#3e2a52")}/>
   <circle cx="${w / 2}" cy="${h * .28}" r="22" fill="#9ff3ff" opacity=".8"/>`; break;
  case "shelf": body = `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="6" ${shade("#5b3a24")}/>
   ${[0.2, 0.42, 0.64, 0.86].map(f => `<rect x="14" y="${h * f}" width="${w - 28}" height="10" fill="#3a2516"/>` + Array.from({ length: 9 }, (_, k) => `<rect x="${24 + k * (w - 48) / 9}" y="${h * f - 70 + (k % 3) * 8}" width="${(w - 60) / 10}" height="${70 - (k % 3) * 8}" fill="${["#c0392b", "#2e86de", "#f6b93b", "#38ada9", "#8e44ad"][k % 5]}"/>`).join("")).join("")}`; break;
  case "plant": body = `<path d="M${w / 2} ${h * .62} C ${w * .1} ${h * .3}, ${w * .1} ${h * .05}, ${w * .45} ${h * .02} C ${w * .9} ${h * .05}, ${w * .95} ${h * .35}, ${w / 2} ${h * .62}Z" ${shade("#2f8f4e")}/>
   <rect x="${w * .25}" y="${h * .6}" width="${w * .5}" height="${h * .38}" rx="12" ${shade("#b5653a")}/>`; break;
  case "arcade": body = `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="10" ${shade("#26214a")}/><rect x="16" y="${h * .14}" width="${w - 32}" height="${h * .3}" rx="6" fill="#59f7c4" opacity=".85"/>
   <rect x="8" y="${h * .5}" width="${w - 16}" height="${h * .1}" fill="#ff4fa3"/><circle cx="${w * .35}" cy="${h * .55}" r="8" fill="#ffe14f"/>`; break;
 }
 return `<svg class="prop" data-prop="${pr.id}" style="left:${x}px;top:${top}px;width:${w}px;height:${h}px;z-index:${Math.round(pr.foot.y2 * 10)}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><title>${pr.foot.label}</title>${body}</svg>`;
}

// ---- Placeholder "illustrated" 256×256 character: smooth shading, eight facings, walk cycle (no art files)
const YAW = { s: 0, se: 45, e: 90, ne: 135, n: 180, nw: -135, w: -90, sw: -45 };
function drawCharacter(ctx, c, facing, phase, walking, breath) {
 ctx.clearRect(0, 0, 256, 256);
 ctx.save();
 let yaw = YAW[facing] ?? 0;
 if (yaw < 0) { ctx.translate(256, 0); ctx.scale(-1, 1); yaw = -yaw; }
 const rad = yaw * Math.PI / 180, side = Math.sin(rad), front = Math.cos(rad);
 const swing = walking ? Math.sin(phase * Math.PI * 2) : 0, bob = walking ? -Math.abs(Math.sin(phase * Math.PI * 2)) * 5 : breath * 1.4;
 const ink = "rgba(18,12,22,.85)";
 // ground shadow
 const sh = ctx.createRadialGradient(128, 246, 4, 128, 246, 44); sh.addColorStop(0, "rgba(0,0,0,.42)"); sh.addColorStop(1, "rgba(0,0,0,0)");
 ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(128, 246, 46, 9, 0, 0, Math.PI * 2); ctx.fill();
 const hipY = 160 + bob, torsoW = 80 - side * 30, shoulderY = 94 + bob;
 const limb = (x1, y1, x2, y2, w, color) => { ctx.lineCap = "round"; ctx.strokeStyle = ink; ctx.lineWidth = w + 5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); };
 const leg = sign => {
  const hx = 128 + sign * (16 - side * 12) + side * 4, ang = side * sign * swing * 0.5, lift = (1 - side) * Math.max(0, sign * swing) * 12;
  const fx = hx + Math.sin(ang) * 78, fy = Math.min(240, hipY + Math.cos(ang) * 80 - lift);
  limb(hx, hipY, fx, fy, 24, c.pants);
  ctx.fillStyle = c.shoe; ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(fx + side * 8, fy + 4, 15 + side * 6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
 };
 const arm = sign => {
  const sx = 128 + sign * (torsoW / 2 - 2) * (1 - side * 0.55) + side * 6, ang = -sign * swing * (0.35 + side * 0.25);
  const hx = sx + Math.sin(ang) * 64 + sign * (1 - side) * 6, hy = shoulderY + Math.cos(ang) * 64;
  limb(sx, shoulderY + 6, hx, hy, 18, c.jacket);
  ctx.fillStyle = c.skin; ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy + 4, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
 };
 // far limbs first (side views hide them partly behind the body)
 const far = front >= 0 ? -1 : 1;
 leg(far); if (side > 0.3) arm(far);
 leg(-far);
 // torso with soft vertical shading
 const tg = ctx.createLinearGradient(0, shoulderY, 0, hipY + 8); tg.addColorStop(0, c.jacket); tg.addColorStop(1, shadeColor(c.jacket, -0.28));
 ctx.fillStyle = tg; ctx.strokeStyle = ink; ctx.lineWidth = 5;
 roundRect(ctx, 128 - torsoW / 2, shoulderY - 6, torsoW, hipY - shoulderY + 14, 22); ctx.fill(); ctx.stroke();
 if (front > 0.25) { ctx.fillStyle = c.trim; roundRect(ctx, 128 - 8 + side * 14, shoulderY, 16, hipY - shoulderY, 6); ctx.fill();
  ctx.fillStyle = "#ffd84a"; star(ctx, 128 - 22 + side * 8, shoulderY + 30, 7); }
 else if (front < -0.25) { ctx.strokeStyle = shadeColor(c.jacket, -0.35); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(128, shoulderY + 4); ctx.lineTo(128, hipY); ctx.stroke(); }
 if (side <= 0.3) { arm(-1); arm(1); } else arm(-far);
 // head
 const headY = 54 + bob;
 limb(128 + side * 4, shoulderY - 8, 128 + side * 4, headY + 24, 20, c.skin);
 const hg = ctx.createRadialGradient(118 + side * 10, headY - 12, 6, 128, headY, 40); hg.addColorStop(0, shadeColor(c.skin, 0.12)); hg.addColorStop(1, shadeColor(c.skin, -0.12));
 ctx.fillStyle = hg; ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(128 + side * 6, headY, 34 - side * 4, 37, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
 if (front > -0.2) {
  const ex = 128 + side * 18;
  ctx.fillStyle = "#1c1424";
  if (side < 0.75) { ctx.beginPath(); ctx.ellipse(ex - 12 * (1 - side * 0.6), headY + 2, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(ex + 12 * (1 - side * 0.6), headY + 2, 4.5, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = shadeColor(c.skin, -0.45); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ex + side * 4, headY + 18, 7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
 }
 // hair: a cap on top, fuller from behind
 ctx.fillStyle = c.hair; ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.beginPath();
 if (front < -0.2) ctx.ellipse(128 + side * 6, headY - 4, 37, 38, 0, Math.PI * 0.95, Math.PI * 2.05);
 else ctx.ellipse(128 + side * 2, headY - 14, 38, 28, 0, Math.PI * 0.92, Math.PI * 2.08);
 ctx.closePath(); ctx.fill(); ctx.stroke();
 for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(128 + k * 14 + side * 6, headY - 34); ctx.lineTo(128 + k * 14 + 9 + side * 10, headY - 52 + Math.abs(k) * 4); ctx.lineTo(128 + k * 14 + 16 + side * 6, headY - 30); ctx.fill(); }
 if (c.phones) { ctx.strokeStyle = c.trim; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(128 + side * 6, headY - 2, 38, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.fillStyle = c.trim; ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(128 + side * 6 + (side > 0.5 ? 0 : -36), headY + 4, 9, 14, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
 ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function star(ctx, x, y, r) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
function shadeColor(hex, amount) {
 const n = parseInt(hex.slice(1), 16), ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) + (amount > 0 ? (255 - ((n >> s) & 255)) * amount : ((n >> s) & 255) * amount))));
 return "#" + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, "0")).join("");
}

// ---- Setup
const viewport = document.getElementById("viewport"), worldEl = document.getElementById("world"), labelsEl = document.getElementById("labels-layer"), hud = document.getElementById("hud");
worldEl.style.width = W + "px"; worldEl.style.height = H + "px";
worldEl.innerHTML = envSvg() + PROPS.map(propSvg).join("");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const crowd = new crowdLib.WorldCrowd(LAB);
const plan = floor.worldRoomPlan(LAB);
const actors = CAST.map((c, i) => {
 const route = wander.worldWanderPlan({ theme: LAB, seed: "lab:" + c.id, start: plan.homes[i], gait: "humanoid", legs: 6 });
 const member = { id: c.id, priority: 2000 + crowdLib.worldCrowdTieBreak(c.id), rx: 1.4, ry: 0.8, speed: wander.WORLD_GAITS.humanoid.speed,
  plan: t => { const q = wander.worldWanderPose(route, t); return { x: q.x, y: q.y, walking: q.walking, facing: q.facing }; } };
 crowd.join(member, i * 1700, 0);
 const el = document.createElement("div"); el.className = "actor"; el.dataset.id = c.id; el.setAttribute("aria-label", c.name);
 const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256; el.append(canvas); worldEl.append(el);
 const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = c.name; labelsEl.append(tag);
 const hi = document.createElement("canvas"); hi.width = hi.height = 256;
 const opt = document.createElement("option"); opt.value = c.id; opt.textContent = c.name; document.getElementById("follow").append(opt);
 return { c, route, el, canvas, ctx: canvas.getContext("2d"), hi, hctx: hi.getContext("2d"), tag, key: "", view: null };
});

// ---- State
let size = { width: viewport.clientWidth, height: viewport.clientHeight };
let presentationChoice = pres.cleanWorldPresentationChoice(params.get("look"));
let presentation = "hd";
let camera = cam.worldCameraFit(WORLD, size);
let following = params.get("follow") ? actors[Math.max(0, Math.min(actors.length - 1, Number(params.get("follow")) - 1))] : null;
let labelsOn = true, paused = reducedMotion || params.has("static"), simTime = 0;
const stats = { frames: 0, last: performance.now(), fps: 0, ms: 0 };
const sr = document.getElementById("sr");
function applyPresentation() {
 presentation = pres.worldPresentation(presentationChoice, { width: innerWidth, coarse: matchMedia("(pointer: coarse)").matches });
 for (const a of actors) { a.el.classList.toggle("pixel", presentation === "pixel"); const px = presentation === "pixel" ? 40 : 256; if (a.canvas.width !== px) { a.canvas.width = a.canvas.height = px; a.key = ""; } }
}
function defaultCamera() {
 const z = params.get("zoom") ? Number(params.get("zoom")) : presentation === "hd" ? 0.55 : 0;
 return cam.worldCameraClamp({ x: W * 0.48, y: H * 0.62, zoom: z }, WORLD, size, MAX_ZOOM);
}
applyPresentation(); camera = defaultCamera();

// ---- Simulation + rendering
function step(dt) {
 simTime += dt;
 for (const a of actors) crowd.advance(a.c.id, dt, simTime);
}
function render(dt) {
 const t0 = performance.now();
 if (following) {
  const pose = crowd.pose(following.c.id);
  camera = cam.worldCameraFollow(camera, { x: pose.x / 100 * W, y: pose.y / 100 * H - FIGURE * 0.5 }, dt, WORLD, size, { reduced: reducedMotion, max: MAX_ZOOM });
 }
 worldEl.style.transform = cam.worldCameraTransform(camera, size);
 const vis = cam.worldCameraVisible(camera, size, ACTOR_PX);
 let shown = 0;
 for (const a of actors) {
  const cp = crowd.pose(a.c.id), view = crowdLib.worldCrowdView(wander.worldWanderPose(a.route, cp.time), cp, "facing");
  const wx = view.x / 100 * W, wy = view.y / 100 * H, on = wx > vis.x1 && wx < vis.x2 && wy > vis.y1 && wy < vis.y2 + ACTOR_PX;
  a.el.style.visibility = on ? "visible" : "hidden";
  const s = cam.worldToScreen(camera, size, { x: wx, y: wy });
  a.tag.style.display = on && labelsOn && (camera.zoom >= 0.4 || a === following) ? "block" : "none";
  a.tag.style.left = s.x + "px"; a.tag.style.top = s.y + "px"; a.tag.classList.toggle("followed", a === following);
  if (!on) continue;
  shown++;
  a.el.style.left = wx + "px"; a.el.style.top = wy + "px"; a.el.style.zIndex = String(Math.round(view.y * 10) + 1);
  // Footsteps follow distance actually walked (no sliding); idle breathes slowly.
  const phase = view.walking ? (cp.walked / 2.4) % 1 : 0, breath = Math.sin(simTime / 650);
  const key = presentation + view.facing + (view.walking ? Math.floor(phase * 12) : "i" + Math.round(breath * 3));
  if (key !== a.key) {
   a.key = key;
   if (presentation === "pixel") { drawCharacter(a.hctx, a.c, view.facing, phase, view.walking, breath); a.ctx.imageSmoothingEnabled = true; a.ctx.clearRect(0, 0, 40, 40); a.ctx.drawImage(a.hi, 0, 0, 40, 40); }
   else drawCharacter(a.ctx, a.c, view.facing, phase, view.walking, breath);
  }
 }
 document.getElementById("zoomlabel").textContent = Math.round(camera.zoom * 100) + "%";
 stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
 hud.textContent = `zoom ${Math.round(camera.zoom * 100)}% · character ≈${Math.round(FIGURE * camera.zoom)} css px tall · ${(256 / ACTOR_PX / camera.zoom / devicePixelRatio).toFixed(2)} art px per device px · look ${presentation}${presentation === "pixel" ? " (downsampled fallback, not production pixel art)" : ""}\n`
  + `on screen ${shown}/${actors.length} · ${stats.fps} fps · render ${stats.ms.toFixed(2)} ms · dpr ${devicePixelRatio}${reducedMotion ? " · reduced motion: paused, camera snaps" : ""}`;
}
let last = performance.now();
function frame(now) {
 const dt = Math.min(100, now - last); last = now;
 if (!paused && !document.hidden) step(dt);
 render(dt);
 stats.frames++; if (now - stats.last > 1000) { stats.fps = stats.frames; stats.frames = 0; stats.last = now; }
 requestAnimationFrame(frame);
}

// ---- Input: mouse/trackpad, touch (pan + pinch), keyboard, buttons
const pointers = new Map(); let dragMoved = 0, downOn = null;
const local = e => { const r = viewport.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function stopFollow(reason) { if (following) { following = null; document.getElementById("follow").value = ""; if (reason) sr.textContent = reason; } }
function follow(a) { following = a; document.getElementById("follow").value = a ? a.c.id : ""; sr.textContent = a ? "Following " + a.c.name : "Not following"; }
viewport.addEventListener("pointerdown", e => {
 viewport.setPointerCapture(e.pointerId); pointers.set(e.pointerId, local(e)); dragMoved = 0;
 downOn = e.target.closest?.(".actor")?.dataset.id ?? null; viewport.classList.add("dragging");
});
viewport.addEventListener("pointermove", e => {
 if (!pointers.has(e.pointerId)) return;
 const prev = [...pointers.values()], before = pointers.get(e.pointerId), now = local(e);
 pointers.set(e.pointerId, now);
 if (pointers.size === 1) {
  dragMoved += Math.hypot(now.x - before.x, now.y - before.y);
  if (dragMoved > 6) { stopFollow(); camera = cam.worldCameraPan(camera, now.x - before.x, now.y - before.y, WORLD, size, MAX_ZOOM); }
 } else if (pointers.size === 2) {
  dragMoved = 99; stopFollow();
  const after = [...pointers.values()];
  camera = cam.worldCameraPinch(camera, [prev[0], prev[1]], [after[0], after[1]], WORLD, size, MAX_ZOOM);
 }
});
const up = e => {
 pointers.delete(e.pointerId); viewport.classList.remove("dragging");
 if (dragMoved <= 6 && downOn) follow(actors.find(a => a.c.id === downOn));
 downOn = null;
};
viewport.addEventListener("pointerup", up); viewport.addEventListener("pointercancel", up);
viewport.addEventListener("wheel", e => { e.preventDefault(); camera = cam.worldCameraZoomAt(camera, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), local(e), WORLD, size, MAX_ZOOM); }, { passive: false });
viewport.addEventListener("dblclick", e => { camera = cam.worldCameraZoomAt(camera, 1.6, local(e), WORLD, size, MAX_ZOOM); });
viewport.addEventListener("keydown", e => {
 const k = e.key, center = { x: size.width / 2, y: size.height / 2 };
 const pan = (dx, dy) => { stopFollow(); camera = cam.worldCameraPan(camera, dx, dy, WORLD, size, MAX_ZOOM); };
 if (k === "ArrowLeft" || k === "a") pan(60, 0); else if (k === "ArrowRight" || k === "d") pan(-60, 0);
 else if (k === "ArrowUp" || k === "w") pan(0, 60); else if (k === "ArrowDown" || k === "s") pan(0, -60);
 else if (k === "+" || k === "=") camera = cam.worldCameraZoomAt(camera, 1.25, center, WORLD, size, MAX_ZOOM);
 else if (k === "-" || k === "_") camera = cam.worldCameraZoomAt(camera, 0.8, center, WORLD, size, MAX_ZOOM);
 else if (k === "0") { stopFollow(); camera = cam.worldCameraFit(WORLD, size); }
 else if (k === "f" || k === "F") follow(actors[(actors.indexOf(following) + 1) % actors.length]);
 else if (k === "Escape") stopFollow("Not following");
 else return;
 e.preventDefault();
});
const center = () => ({ x: size.width / 2, y: size.height / 2 });
document.getElementById("fit").onclick = () => { stopFollow(); camera = cam.worldCameraFit(WORLD, size); };
document.getElementById("in").onclick = () => { camera = cam.worldCameraZoomAt(camera, 1.25, center(), WORLD, size, MAX_ZOOM); };
document.getElementById("out").onclick = () => { camera = cam.worldCameraZoomAt(camera, 0.8, center(), WORLD, size, MAX_ZOOM); };
document.getElementById("follow").onchange = e => follow(actors.find(a => a.c.id === e.target.value) ?? null);
document.getElementById("presentation").value = presentationChoice;
document.getElementById("presentation").onchange = e => { presentationChoice = pres.cleanWorldPresentationChoice(e.target.value); applyPresentation(); };
document.getElementById("labels").onclick = e => { labelsOn = !labelsOn; e.currentTarget.setAttribute("aria-pressed", String(labelsOn)); };
const pauseBtn = document.getElementById("pause");
const syncPause = () => { pauseBtn.setAttribute("aria-pressed", String(paused)); pauseBtn.textContent = paused ? "Play" : "Pause"; };
pauseBtn.onclick = () => { paused = !paused; syncPause(); }; syncPause();
new ResizeObserver(() => { size = { width: viewport.clientWidth, height: viewport.clientHeight }; applyPresentation(); camera = cam.worldCameraClamp(camera, WORLD, size, MAX_ZOOM); }).observe(viewport);

// ---- Deterministic hooks for screenshots/tests (fixed 100 ms steps)
window.__lab = {
 advanceTo(ms) { while (simTime + 100 <= ms) step(100); render(16); },
 tick(ms) { step(ms); render(ms); },
 camera(c) { camera = cam.worldCameraClamp({ ...camera, ...c }, WORLD, size, MAX_ZOOM); render(16); },
 follow(n) { follow(n ? actors[n - 1] : null); for (let i = 0; i < 60; i++) render(100); },
 fit() { camera = cam.worldCameraFit(WORLD, size); render(16); },
 look(v) { presentationChoice = pres.cleanWorldPresentationChoice(v); applyPresentation(); render(16); },
 state() { return { camera, presentation, simTime, actors: actors.map(a => crowd.pose(a.c.id)) }; },
};
if (params.get("t")) window.__lab.advanceTo(Number(params.get("t")));
requestAnimationFrame(frame);
window.__labReady = true;
})();
