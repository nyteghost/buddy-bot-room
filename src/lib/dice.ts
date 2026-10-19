/** Tabletop dice. Pure: the random source is passed in so rolls can be tested. */
export type DiceSpec = { count: number; sides: number; mod: number; mode: "normal" | "adv" | "dis" };
export type DiceParse = ({ ok: true } & DiceSpec) | { ok: false; error: string };
export type DiceRoll = { spec: DiceSpec; rolls: number[]; kept: number[]; total: number; nat20: boolean; nat1: boolean; text: string };

export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
const USAGE = "Try /roll d20, /roll 2d6+3, or /roll d20 adv.";

/** Accepts "d20", "2d6+3", "4d8 - 1", "d20 adv", "d20 dis". Advantage/disadvantage only apply to a single d20. */
export function parseDice(input: string): DiceParse {
  const text = input.trim().toLowerCase();
  const m = text.match(/^(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*(adv|advantage|dis|disadvantage)?$/);
  if (!m) return { ok: false, error: USAGE };
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  const mod = m[3] && m[4] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0;
  const mode = m[5] ? (m[5].startsWith("adv") ? "adv" : "dis") : "normal";
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE) return { ok: false, error: `Roll between 1 and ${MAX_DICE} dice at a time.` };
  if (!Number.isInteger(sides) || sides < 2 || sides > MAX_SIDES) return { ok: false, error: `Dice need 2 to ${MAX_SIDES} sides.` };
  if (mod > 100000) return { ok: false, error: USAGE };
  if (mode !== "normal" && !(count === 1 && sides === 20)) return { ok: false, error: "Advantage and disadvantage only work on a single d20: /roll d20 adv." };
  return { ok: true, count, sides, mod, mode };
}

/** rng must return a number in [0, 1). */
export function rollDice(spec: DiceSpec, rng: () => number): DiceRoll {
  const one = () => Math.min(spec.sides, Math.floor(rng() * spec.sides) + 1);
  const dice = spec.mode === "normal" ? spec.count : 2;
  const rolls = Array.from({ length: dice }, one);
  const kept = spec.mode === "adv" ? [Math.max(...rolls)] : spec.mode === "dis" ? [Math.min(...rolls)] : rolls;
  const sum = kept.reduce((a, b) => a + b, 0);
  const total = sum + spec.mod;
  const single20 = spec.count === 1 && spec.sides === 20;
  const modText = spec.mod ? (spec.mod > 0 ? `+${spec.mod}` : `${spec.mod}`) : "";
  const label = `${spec.count === 1 && spec.mode === "normal" ? "" : spec.count}d${spec.sides}${modText}${spec.mode === "normal" ? "" : spec.mode === "adv" ? " (advantage)" : " (disadvantage)"}`;
  const shown = spec.mode === "normal" ? `[${rolls.join(", ")}]` : `[${rolls.join(", ")}] keep ${kept[0]}`;
  const crit = single20 && kept[0] === 20 ? " — natural 20!" : single20 && kept[0] === 1 ? " — natural 1…" : "";
  return { spec, rolls, kept, total, nat20: single20 && kept[0] === 20, nat1: single20 && kept[0] === 1, text: `🎲 ${label} → ${shown}${modText ? ` ${modText}` : ""} = **${total}**${crit}` };
}

/** Unbiased browser/Node random source. */
export function secureRng(): () => number {
  return () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] ?? 0) / 4294967296;
  };
}
