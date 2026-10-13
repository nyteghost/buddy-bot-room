import type { AgentId } from "@/lib/agents";

type Px = [number, number, string, (string | undefined)?]; // x, y, material, animation class

const r = (x: number, y: number, w: number, h: number, m: string, a?: string): Px[] => {
  const out: Px[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x + i, y + j, m, a]);
  return out;
};

/** Each pal's signature "thinking" activity, drawn as a 16×16 pixel prop. */
const props: Record<AgentId, { label: string; pixels: Px[] }> = {
  // Big-picture thinker: telescope gazing at twinkling stars.
  nova: {
    label: "stargazing through a telescope",
    pixels: [
      ...r(2, 9, 9, 2, "metal"), ...r(10, 8, 2, 4, "dark"), ...r(5, 11, 1, 4, "dark"), ...r(7, 11, 1, 4, "dark"),
      [12, 3, "glow", "tp-twinkle-a"], [14, 6, "glow", "tp-twinkle-b"], [10, 1, "glow", "tp-twinkle-c"], [15, 1, "glow", "tp-twinkle-a"],
    ],
  },
  // Practical problem-solver: typing on a laptop, code scrolling.
  byte: {
    label: "searching on a laptop",
    pixels: [
      ...r(2, 3, 12, 8, "dark"), ...r(3, 4, 10, 6, "screen"),
      ...r(4, 5, 6, 1, "glow", "tp-line-a"), ...r(4, 7, 8, 1, "glow", "tp-line-b"), ...r(4, 9, 4, 1, "glow", "tp-line-c"),
      ...r(1, 11, 14, 2, "metal"), ...r(4, 11, 2, 1, "dark", "tp-tap-a"), ...r(9, 11, 2, 1, "dark", "tp-tap-b"),
    ],
  },
  // Thoughtful challenger: reading a thick book, page flipping.
  sage: {
    label: "studying a book",
    pixels: [
      ...r(1, 6, 7, 8, "paper"), ...r(8, 6, 7, 8, "paper"), ...r(7, 5, 2, 10, "dark"),
      ...r(2, 8, 5, 1, "dark"), ...r(2, 10, 4, 1, "dark"), ...r(9, 8, 5, 1, "dark"), ...r(9, 10, 5, 1, "dark"),
      ...r(9, 3, 5, 8, "paper", "tp-flip"),
    ],
  },
  // Wildcard: vibing to music, notes bouncing.
  pip: {
    label: "listening to music",
    pixels: [
      ...r(2, 9, 2, 2, "glow", "tp-note-a"), ...r(3, 4, 1, 5, "glow", "tp-note-a"), ...r(4, 4, 2, 1, "glow", "tp-note-a"),
      ...r(9, 7, 2, 2, "accent", "tp-note-b"), ...r(13, 6, 2, 2, "accent", "tp-note-b"),
      ...r(10, 2, 1, 5, "accent", "tp-note-b"), ...r(14, 1, 1, 5, "accent", "tp-note-b"), ...r(10, 2, 5, 1, "accent", "tp-note-b"),
    ],
  },
  // Storyteller: quill writing across a scroll.
  echo: {
    label: "writing on a scroll",
    pixels: [
      ...r(1, 8, 14, 6, "paper"), ...r(0, 8, 1, 6, "dark"), ...r(15, 8, 1, 6, "dark"),
      ...r(3, 10, 8, 1, "dark", "tp-ink"), ...r(3, 12, 5, 1, "dark", "tp-ink"),
      ...r(11, 2, 2, 6, "accent", "tp-quill"), ...r(10, 8, 1, 2, "dark", "tp-quill"),
    ],
  },
  // Inventor: wrench on a gear, sparks flying.
  rune: {
    label: "tinkering with a gadget",
    pixels: [
      ...r(4, 8, 6, 6, "metal", "tp-spin"), ...r(6, 7, 2, 8, "metal", "tp-spin"), ...r(3, 10, 8, 2, "metal", "tp-spin"), ...r(6, 10, 2, 2, "dark", "tp-spin"),
      ...r(10, 3, 2, 7, "dark", "tp-wrench"), ...r(9, 2, 4, 2, "dark", "tp-wrench"),
      [13, 6, "glow", "tp-twinkle-a"], [14, 4, "glow", "tp-twinkle-b"], [12, 1, "glow", "tp-twinkle-c"],
    ],
  },
  // Synthesizer: sketching a diagram on a whiteboard.
  claude: {
    label: "drawing on a whiteboard",
    pixels: [
      ...r(1, 1, 14, 10, "paper"), ...r(0, 0, 16, 1, "dark"), ...r(0, 11, 16, 1, "dark"),
      ...r(3, 14, 1, 2, "dark"), ...r(12, 14, 1, 2, "dark"), ...r(3, 12, 1, 2, "dark"), ...r(12, 12, 1, 2, "dark"),
      ...r(3, 3, 3, 3, "accent", "tp-draw-a"), ...r(6, 4, 3, 1, "accent", "tp-draw-b"),
      ...r(9, 3, 3, 3, "accent", "tp-draw-c"), ...r(5, 8, 6, 1, "glow", "tp-draw-c"),
    ],
  },
};

export function ThinkingProp({ id }: { id: AgentId }) {
  const prop = props[id];
  if (!prop) return null;
  return (
    <svg
      viewBox="0 0 16 16"
      className={`thinking-prop thinking-${id}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={prop.label}
    >
      {prop.pixels.map(([x, y, m, a], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" className={`tp-${m} ${a ?? ""}`} />
      ))}
    </svg>
  );
}
