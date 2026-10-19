/** A short burst of confetti for when the pals crack a problem. Skipped for reduced-motion users. */
const COLORS = ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#f78c6b", "#c77dff", "#ffffff"];

export function celebrate(origin?: { x: number; y: number }, count = 70): void {
  if (typeof document === "undefined" || typeof document.body.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight * 0.4;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:9999";
  let longest = 0;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("i");
    const size = 5 + Math.random() * 7;
    const round = Math.random() > 0.5;
    piece.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${round ? size : size * 0.6}px;background:${COLORS[i % COLORS.length]};border-radius:${round ? "50%" : "2px"}`;
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 180;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed - 120;
    const duration = 900 + Math.random() * 900;
    longest = Math.max(longest, duration);
    piece.animate(
      [
        { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px,${dy + 240}px) rotate(${360 + Math.random() * 360}deg) scale(0)`, opacity: 0 },
      ],
      { duration, easing: "cubic-bezier(0.15, 0.6, 0.35, 1)", fill: "forwards" },
    );
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), longest + 100);
}
