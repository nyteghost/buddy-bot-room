import type { AgentId } from "./agents";

/** Optional, purely visual activities. Pals do not inspect user files or do real work. */
export type PalActivity = { emoji: string; text: string };
const activities: Record<AgentId, readonly PalActivity[]> = {
  nova: [{ emoji: "🗺️", text: "Sketching new ideas" }, { emoji: "🌱", text: "Looking after the plants" }, { emoji: "✨", text: "Daydreaming" }],
  byte: [{ emoji: "💻", text: "Tinkering with a computer" }, { emoji: "🧩", text: "Solving a tiny puzzle" }, { emoji: "🛠️", text: "Sorting tools" }],
  sage: [{ emoji: "📖", text: "Reading by the desk" }, { emoji: "☕", text: "Taking a tea break" }, { emoji: "📝", text: "Writing notes" }],
  pip: [{ emoji: "🎲", text: "Playing with dice" }, { emoji: "📌", text: "Moving sticky notes" }, { emoji: "🎨", text: "Making tiny doodles" }],
  echo: [{ emoji: "📚", text: "Reading a story" }, { emoji: "🎵", text: "Humming quietly" }, { emoji: "✏️", text: "Doodling a scene" }],
  rune: [{ emoji: "⚙️", text: "Testing a gadget" }, { emoji: "🔍", text: "Inspecting a gizmo" }, { emoji: "🧰", text: "Organizing inventions" }],
  claude: [{ emoji: "📓", text: "Reviewing a notebook" }, { emoji: "🫖", text: "Making tea" }, { emoji: "📐", text: "Sketching a diagram" }],
  saiyan: [{ emoji: "💪", text: "Practicing a power-up" }, { emoji: "🧘", text: "Stretching" }, { emoji: "🥤", text: "Getting some water" }],
};
export function palActivity(id: AgentId, phase: number): PalActivity {
  const list = activities[id];
  return list[Math.abs(Math.trunc(Number.isFinite(phase) ? phase : 0)) % list.length]!;
}

export const PAL_ROOM_MOOD_KEY = "pixel-pals-room-playful-v1";
