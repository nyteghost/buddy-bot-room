import { useEffect, useState } from "react";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import type { WorldHdDirection } from "@/lib/world-hd";
import { selectWorldHdClip, worldHdAction, worldHdFrameAt } from "@/lib/world-hd-animation";
import { worldHdDisplaySize, worldHdFrameGrid } from "@/lib/world-hd-render";

/** Crisp on-screen size for HD art: detects the pack's pixel grid once, then whole device pixels per art pixel. */
export function useWorldHdSize(src: string | undefined): { size: number; grid: number } {
 const [grid, setGrid] = useState(1);
 useEffect(() => { let live = true; setGrid(1); if (src) void worldHdFrameGrid(src).then(found => { if (live) setGrid(found); }); return () => { live = false; }; }, [src]);
 const phone = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;
 return { size: worldHdDisplaySize(phone ? 48 : 76, typeof window !== "undefined" ? window.devicePixelRatio : 1, grid), grid };
}

/**
 * An original Pal drawn with an owner-chosen imported HD256 look (visual only). Same clip selection,
 * honest fallbacks and crisp scaling as HD visitors; the Pal's identity is untouched.
 */
export function WorldHdSkin({ character, facing, motion, walking, elapsed, name }: {
 character: WorldCustomCharacter; facing: WorldHdDirection; motion: string | undefined; walking: boolean; elapsed: number; name: string;
}) {
 const kind = worldHdAction(walking ? "walk" : motion ?? "idle");
 const selected = character.hd3 ? selectWorldHdClip(character.hd3, facing, kind) : undefined;
 const legacy = character.hd ? ((walking ? character.hd.walk : kind === "wave" ? character.hd.wave : kind === "celebrate" ? character.hd.celebrate : undefined) ?? character.hd.idle) : undefined;
 const src = selected ? worldHdFrameAt(selected.clip, elapsed) : legacy?.[Math.floor(elapsed / 175) % legacy.length];
 const { size, grid } = useWorldHdSize(character.hd3?.directions.s?.idle?.frames[0]?.src ?? character.hd?.idle[0]);
 if (!src) return null;
 return <img className={"world-pal-hd-art" + (grid > 1 ? " world-hd-crisp" : "")} src={src} width={256} height={256} draggable={false}
  style={{ width: size, height: size }} data-hd-grid={grid} data-facing={selected?.direction ?? facing}
  data-hd-fallback={selected ? [selected.direction !== facing && "facing", selected.action !== kind && "clip"].filter(Boolean).join("+") || undefined : undefined}
  alt={name + " in " + character.name + " look"} />;
}
