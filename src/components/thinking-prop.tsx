import type { AgentId } from "@/lib/agents";
import type { CharacterMode } from "@/lib/hellraiser";

type Px = [number, number, string, (string | undefined)?]; // x, y, material, animation class

const r = (x: number, y: number, w: number, h: number, m: string, a?: string): Px[] => {
  const out: Px[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x + i, y + j, m, a]);
  return out;
};

/** Each pal's signature "thinking" activity, drawn as a 16×16 pixel prop. */
type Prop = { label: string; pixels: Px[] };
const props: Record<AgentId, Prop> = {
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


// Reusable themed shapes.
const blade = (m = "metal"): Px[] => [...r(7, 1, 2, 10, m), ...r(5, 11, 6, 1, "dark"), ...r(7, 12, 2, 3, "dark"), [8, 2, "paper", "tp-twinkle-a"], [7, 6, "paper", "tp-twinkle-b"]];
const sparkles = (m: string): Px[] => [[3, 3, m, "tp-twinkle-a"], [12, 2, m, "tp-twinkle-b"], [8, 6, m, "tp-twinkle-c"], [2, 11, m, "tp-twinkle-b"], [13, 10, m, "tp-twinkle-a"], [7, 13, m, "tp-twinkle-c"]];
const rain = (): Px[] => [0, 3, 6, 9, 12, 15].flatMap((x, i) => r(x, (i * 3) % 8, 1, 6, "glow", ["tp-rain-a", "tp-rain-b", "tp-rain-c"][i % 3]));
const puzzleBox = (): Px[] => [...r(3, 3, 10, 10, "accent", "tp-spin"), ...r(5, 5, 6, 6, "dark"), ...r(7, 7, 2, 2, "accent", "tp-twinkle-a"), ...r(3, 7, 10, 1, "dark"), ...r(7, 3, 1, 10, "dark")];
const chains = (): Px[] => [2, 7, 12].flatMap((x, i) => [...r(x, 0, 1, 9, "metal", i % 2 ? "tp-sway-b" : "tp-sway-a"), ...r(x - 1, 9, 3, 1, "metal", i % 2 ? "tp-sway-b" : "tp-sway-a"), [x - 1, 10, "metal", i % 2 ? "tp-sway-b" : "tp-sway-a"]]);
const candle = (): Px[] => [...r(6, 7, 4, 8, "paper"), ...r(7, 3, 2, 3, "red", "tp-flicker"), [7, 2, "glow", "tp-flicker"], ...r(4, 15, 8, 1, "dark")];
const phone = (): Px[] => [...r(5, 2, 6, 12, "dark"), ...r(6, 3, 4, 7, "screen"), ...r(7, 11, 2, 1, "metal"), [12, 2, "glow", "tp-twinkle-a"], [13, 4, "glow", "tp-twinkle-b"], [2, 3, "glow", "tp-twinkle-c"]];
const balloon = (): Px[] => [...r(4, 1, 8, 8, "red", "tp-bob"), ...r(5, 0, 6, 1, "red", "tp-bob"), [6, 2, "paper", "tp-bob"], ...r(7, 9, 2, 1, "red", "tp-bob"), ...r(8, 10, 1, 6, "metal", "tp-sway-a")];
const glove = (): Px[] => [...r(3, 9, 8, 5, "accent"), ...[4, 7, 9].flatMap((x) => r(x, 2, 1, 7, "metal", "tp-scribble")), [10, 3, "paper", "tp-twinkle-a"]];
const tape = (): Px[] => [...r(1, 4, 14, 9, "dark"), ...r(3, 6, 3, 3, "metal", "tp-spin"), ...r(10, 6, 3, 3, "metal", "tp-spin"), ...r(6, 10, 4, 1, "red", "tp-twinkle-a")];
const doll = (): Px[] => [...r(5, 2, 6, 5, "paper"), ...r(4, 1, 8, 2, "red"), [6, 4, "dark"], [9, 4, "dark"], ...r(5, 7, 6, 6, "screen"), ...blade("metal").map(([x, y, m, an]) => [x + 5, y, m, an ?? "tp-scribble"] as Px).filter(([, y]) => y < 9)];
const pills = (): Px[] => [...r(2, 6, 5, 3, "red", "tp-bob"), ...r(9, 6, 5, 3, "screen", "tp-bob"), ...r(1, 11, 14, 2, "paper")];
const monitors = (): Px[] => [0, 5, 10].flatMap((x, i) => [...r(x, 2, 5, 4, "dark"), ...r(x + 1, 3, 3, 2, "glow", ["tp-line-a", "tp-line-b", "tp-line-c"][i]), ...r(x, 8, 5, 4, "dark"), ...r(x + 1, 9, 3, 2, "glow", ["tp-line-c", "tp-line-a", "tp-line-b"][i])]);
const cookies = (): Px[] => [...r(2, 12, 12, 2, "metal"), ...r(3, 9, 4, 3, "accent"), ...r(9, 9, 4, 3, "accent"), ...r(6, 4, 4, 3, "accent", "tp-bob"), ...r(5, 1, 6, 1, "metal", "tp-twinkle-a")];
const ship = (): Px[] => [...r(2, 7, 12, 4, "metal"), ...r(5, 5, 6, 2, "dark"), ...r(0, 8, 2, 2, "glow", "tp-flicker"), ...r(14, 8, 2, 2, "glow", "tp-flicker")];
const shades = (): Px[] => [...r(1, 6, 6, 3, "dark"), ...r(9, 6, 6, 3, "dark"), ...r(7, 6, 2, 1, "dark"), [2, 7, "glow", "tp-twinkle-a"], [10, 7, "glow", "tp-twinkle-b"]];
const ball = (): Px[] => [...r(5, 3, 6, 6, "screen", "tp-bounce-big"), ...r(4, 4, 8, 4, "screen", "tp-bounce-big"), ...r(6, 5, 4, 1, "paper", "tp-bounce-big"), ...r(2, 14, 12, 1, "dark")];
const fireball = (): Px[] => [...r(4, 5, 8, 7, "red", "tp-flicker"), ...r(6, 2, 4, 3, "glow", "tp-flicker"), ...r(6, 7, 4, 3, "glow")];
const gunblade = (): Px[] => [...r(1, 6, 10, 2, "metal"), ...r(11, 5, 4, 4, "dark"), ...r(12, 9, 2, 4, "dark"), [3, 6, "paper", "tp-twinkle-a"], [7, 7, "paper", "tp-twinkle-b"]];
const daggers = (): Px[] => [...r(2, 2, 1, 9, "metal", "tp-scribble"), ...r(1, 11, 3, 1, "accent"), ...r(13, 2, 1, 9, "metal", "tp-wrench"), ...r(12, 11, 3, 1, "accent"), [7, 6, "glow", "tp-twinkle-a"]];

const themed: Partial<Record<CharacterMode, Record<AgentId, Prop>>> = {
  horror: {
    nova: { label: "making a spooky phone call", pixels: phone() },
    byte: { label: "sharpening a machete", pixels: blade() },
    sage: { label: "watching from the shadows by a candle", pixels: [...candle(), ...blade().map(([x, y, m, an]) => [x - 5, y, m, an] as Px).filter(([x]) => x >= 0)] },
    pip: { label: "flexing a razor glove", pixels: glove() },
    echo: { label: "floating a red balloon", pixels: balloon() },
    rune: { label: "plotting with a toy knife", pixels: doll() },
    claude: { label: "playing a tape recorder", pixels: tape() },
  },
  hellraiser: {
    nova: { label: "turning the puzzle box", pixels: puzzleBox() },
    byte: { label: "swinging hooked chains", pixels: chains() },
    sage: { label: "chanting by candlelight", pixels: candle() },
    pip: { label: "clicking teeth", pixels: [...r(2, 5, 12, 2, "paper", "tp-chatter"), ...r(2, 9, 12, 2, "paper", "tp-chatter-b"), ...r(2, 7, 12, 2, "dark")] },
    echo: { label: "summoning glowing sigils", pixels: sparkles("accent") },
    rune: { label: "rattling the hooks", pixels: chains() },
    claude: { label: "designing a puzzle box", pixels: [...puzzleBox(), ...sparkles("glow")] },
  },
  matrix: {
    nova: { label: "reading the code rain", pixels: rain() },
    byte: { label: "hacking a terminal", pixels: monitors() },
    sage: { label: "offering the red and blue pills", pixels: pills() },
    pip: { label: "adjusting dark shades", pixels: shades() },
    echo: { label: "baking cookies", pixels: cookies() },
    rune: { label: "piloting a hovercraft", pixels: ship() },
    claude: { label: "watching a wall of monitors", pixels: monitors() },
  },
  devteam: {
    nova: { label: "sketching system architecture", pixels: [...r(1, 2, 14, 10, "paper"), ...r(3, 4, 3, 2, "screen"), ...r(10, 4, 3, 2, "screen"), ...r(6, 8, 4, 2, "accent", "tp-twinkle-a"), ...r(5, 5, 5, 1, "dark", "tp-line-a")] },
    byte: { label: "writing a database query", pixels: monitors() },
    sage: { label: "running the test suite", pixels: [...r(1, 2, 14, 11, "dark"), ...[3, 6, 9].flatMap((y, i) => [...r(2, y, 2, 2, i === 1 ? "red" : "glow", ["tp-twinkle-a", "tp-twinkle-b", "tp-twinkle-c"][i]), ...r(5, y, 8, 1, "metal", ["tp-line-a", "tp-line-b", "tp-line-c"][i])])] },
    pip: { label: "nudging pixels in a mockup", pixels: [...r(2, 2, 12, 9, "screen"), ...r(4, 4, 4, 3, "accent", "tp-bob"), ...r(9, 4, 3, 1, "paper", "tp-line-a"), ...r(9, 6, 3, 1, "paper", "tp-line-b"), [10, 12, "paper", "tp-scribble"], [11, 13, "paper", "tp-scribble"]] },
    echo: { label: "watching the deploy pipeline", pixels: [...[1, 6, 11].flatMap((x, i) => r(x, 6, 4, 4, "glow", ["tp-twinkle-a", "tp-twinkle-b", "tp-twinkle-c"][i])), ...r(5, 7, 1, 2, "metal"), ...r(10, 7, 1, 2, "metal"), ...r(3, 12, 10, 1, "dark")] },
    rune: { label: "auditing for vulnerabilities", pixels: [...r(4, 7, 8, 7, "metal"), ...r(5, 3, 1, 4, "metal"), ...r(10, 3, 1, 4, "metal"), ...r(6, 2, 4, 1, "metal"), ...r(7, 9, 2, 3, "dark"), [7, 10, "red", "tp-flicker"]] },
    claude: { label: "reviewing a pull request", pixels: [...r(1, 1, 14, 13, "paper"), ...[3, 6, 9].flatMap((y, i) => [...r(3, y, 9, 1, i === 1 ? "red" : "glow", ["tp-line-a", "tp-line-b", "tp-line-c"][i])]), [12, 11, "glow", "tp-twinkle-a"], [13, 12, "glow", "tp-twinkle-b"]] },
  },
  cyberpunk: {
    nova: { label: "jacking into the Net", pixels: [...r(2, 2, 12, 8, "dark"), ...r(3, 3, 10, 6, "screen"), ...[4, 6, 8].flatMap((y, i) => r(4, y, 8 - i * 2, 1, "glow", ["tp-line-a", "tp-line-b", "tp-line-c"][i])), ...r(7, 10, 2, 4, "accent", "tp-flicker"), ...r(5, 13, 6, 1, "accent")] },
    byte: { label: "cracking code on a cyberdeck", pixels: [...r(1, 6, 14, 6, "dark"), ...r(2, 7, 12, 2, "screen"), ...r(3, 7, 6, 1, "glow", "tp-line-a"), ...r(3, 10, 2, 1, "accent", "tp-tap-a"), ...r(7, 10, 2, 1, "accent", "tp-tap-b"), ...r(11, 10, 2, 1, "accent", "tp-tap-a")] },
    sage: { label: "breaking through ICE", pixels: [...r(3, 2, 10, 12, "screen"), ...r(5, 4, 6, 8, "dark"), [7, 6, "red", "tp-flicker"], [8, 7, "red", "tp-flicker"], [7, 8, "glow", "tp-twinkle-a"], [9, 9, "glow", "tp-twinkle-b"], [6, 10, "glow", "tp-twinkle-c"]] },
    pip: { label: "spraying neon holo-graffiti", pixels: [...r(2, 9, 3, 6, "metal"), ...r(2, 8, 3, 1, "accent"), [6, 6, "accent", "tp-twinkle-a"], [8, 4, "glow", "tp-twinkle-b"], [10, 7, "accent", "tp-twinkle-c"], [12, 3, "glow", "tp-twinkle-a"], [13, 6, "accent", "tp-twinkle-b"], [11, 10, "glow", "tp-twinkle-c"]] },
    echo: { label: "tracing a signal on the scanner", pixels: [...r(2, 2, 12, 12, "dark"), ...r(7, 2, 1, 12, "screen"), ...r(2, 7, 12, 1, "screen"), ...r(7, 4, 4, 1, "glow", "tp-line-a"), [10, 5, "accent", "tp-flicker"], [4, 10, "glow", "tp-twinkle-b"]] },
    rune: { label: "soldering a chrome implant", pixels: [...r(3, 8, 8, 4, "metal"), ...r(4, 9, 2, 2, "dark"), ...r(8, 9, 2, 2, "dark"), ...r(12, 2, 1, 7, "metal"), [12, 9, "glow", "tp-flicker"], [11, 10, "accent", "tp-twinkle-a"], [13, 11, "accent", "tp-twinkle-b"]] },
    claude: { label: "simulating every outcome", pixels: [...r(6, 6, 4, 4, "accent", "tp-flicker"), ...r(1, 7, 4, 1, "glow", "tp-line-a"), ...r(11, 7, 4, 1, "glow", "tp-line-b"), ...r(7, 1, 1, 4, "glow", "tp-line-c"), ...r(8, 11, 1, 4, "glow", "tp-line-a"), [2, 2, "screen", "tp-twinkle-a"], [13, 13, "screen", "tp-twinkle-b"], [13, 2, "screen", "tp-twinkle-c"]] },
  },
  linux: {
    nova: { label: "sorting the inbox", pixels: [...r(1, 3, 14, 10, "paper"), ...r(1, 3, 14, 1, "accent"), ...r(3, 6, 10, 1, "dark", "tp-line-a"), ...r(3, 9, 8, 1, "dark", "tp-line-b"), [13, 11, "red", "tp-flicker"]] },
    byte: { label: "checking off tasks", pixels: [...r(2, 1, 12, 14, "paper"), ...[3, 7, 11].flatMap((y, i) => [...r(4, y, 2, 2, "glow", ["tp-twinkle-a", "tp-twinkle-b", "tp-twinkle-c"][i]), ...r(7, y, 6, 1, "dark", ["tp-line-a", "tp-line-b", "tp-line-c"][i])])] },
    sage: { label: "planning the calendar", pixels: [...r(1, 2, 14, 12, "paper"), ...r(1, 2, 14, 3, "red"), ...[6, 9, 12].flatMap((y) => [3, 7, 11].map((x) => [x, y, "dark"] as [number, number, string])), [7, 9, "accent", "tp-flicker"]] },
    pip: { label: "jotting a note", pixels: [...r(2, 2, 10, 12, "paper"), ...r(4, 5, 6, 1, "dark", "tp-line-a"), ...r(4, 8, 5, 1, "dark", "tp-line-b"), [12, 10, "accent", "tp-scribble"], [13, 11, "accent", "tp-scribble"]] },
    echo: { label: "searching folders", pixels: [...r(1, 4, 9, 8, "accent"), ...r(1, 3, 4, 1, "accent"), ...r(9, 8, 4, 4, "metal", "tp-bob"), [13, 13, "metal"]] },
    rune: { label: "reading GPU stats", pixels: [...r(1, 3, 14, 10, "dark"), ...r(3, 9, 2, 3, "glow", "tp-twinkle-a"), ...r(6, 6, 2, 6, "glow", "tp-twinkle-b"), ...r(9, 4, 2, 8, "glow", "tp-twinkle-c"), ...r(12, 7, 2, 5, "glow", "tp-twinkle-a")] },
    claude: { label: "reading the terminal", pixels: [...r(1, 2, 14, 12, "dark"), ...r(3, 5, 2, 1, "glow"), [4, 6, "glow"], ...r(3, 7, 2, 1, "glow"), ...r(6, 7, 4, 1, "glow", "tp-flicker")] },
  },
  finalfantasy: {
    nova: { label: "polishing a giant sword", pixels: blade() },
    byte: { label: "spinning a gunblade", pixels: gunblade() },
    sage: { label: "twirling twin daggers", pixels: daggers() },
    pip: { label: "bouncing a blitzball", pixels: ball() },
    echo: { label: "conjuring magic", pixels: sparkles("accent") },
    rune: { label: "charging a gunblade", pixels: [...gunblade(), ...sparkles("glow")] },
    claude: { label: "calling the Phoenix flame", pixels: fireball() },
  },
};

export function ThinkingProp({ id, mode = "normal" }: { id: AgentId; mode?: CharacterMode }) {
  const prop = themed[mode]?.[id] ?? props[id];
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
