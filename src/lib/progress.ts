/** XP, levels and streaks for the room. Small and local: finishing tasks and having discussions earns XP; levels unlock decorations. */
export type Progress = { xp: number; streak: number; lastDay: string; doneSeen: number };
export const emptyProgress: Progress = { xp: 0, streak: 0, lastDay: "", doneSeen: 0 };

export const levelOf = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 25)) + 1;
export const levelStart = (level: number): number => (level - 1) ** 2 * 25;
/** 0..1 progress to the next level. */
export function levelFraction(xp: number): number {
  const l = levelOf(xp);
  const a = levelStart(l);
  return Math.min(1, Math.max(0, (xp - a) / (levelStart(l + 1) - a)));
}

const dayBefore = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function award(p: Progress, amount: number, today: string): Progress {
  if (!(amount > 0)) return p;
  const streak = p.lastDay === today ? Math.max(1, p.streak) : p.lastDay === dayBefore(today) ? p.streak + 1 : 1;
  return { ...p, xp: p.xp + Math.round(amount), streak, lastDay: today };
}

/** Finished tasks earn 10 XP each. Un-ticking or deleting never takes XP away. */
export function syncDone(p: Progress, doneNow: number, today: string): Progress {
  // First run: tasks you finished long ago don't pay out.
  if (p.lastDay === "" && p.xp === 0 && p.doneSeen === 0) return doneNow > 0 ? { ...p, doneSeen: doneNow } : p;
  if (doneNow > p.doneSeen) return { ...award(p, (doneNow - p.doneSeen) * 10, today), doneSeen: doneNow };
  return doneNow < p.doneSeen ? { ...p, doneSeen: doneNow } : p;
}

export const DECOR: { level: number; icon: string; name: string }[] = [
  { level: 2, icon: "🪴", name: "a plant" },
  { level: 3, icon: "🕯️", name: "candles" },
  { level: 4, icon: "🖼️", name: "a painting" },
  { level: 5, icon: "🛋️", name: "a sofa" },
  { level: 7, icon: "🎮", name: "an arcade cabinet" },
  { level: 10, icon: "🏆", name: "a trophy" },
];
export const unlocked = (level: number) => DECOR.filter((d) => d.level <= level);

/** Seasonal extras by month (0 = January). */
export function seasonal(month: number): string[] {
  return ({ 9: ["🎃", "🦇"], 11: ["🎄", "❄️"], 1: ["💝"], 6: ["🎆"], 2: ["🍀"] } as Record<number, string[]>)[month] ?? [];
}
