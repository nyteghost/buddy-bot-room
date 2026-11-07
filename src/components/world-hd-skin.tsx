import { useEffect, useState, type CSSProperties } from "react";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import type { WorldHdDirection } from "@/lib/world-hd";
import { selectWorldHdClip, worldHdAction, worldHdFrameAt } from "@/lib/world-hd-animation";
import { worldHdFrameMetrics } from "@/lib/world-hd-render";
import { worldHdScale, worldPixelSize, type WorldFrameMetrics, type WorldHdScale } from "@/lib/world-scale";

/**
 * In-room scale for an HD character (world-scale.ts): measures its front idle frame once (pixel grid,
 * top of head, lowest foot pixel), then sizes the canvas so the figure stands the standard adult height
 * (times its declared height class) with its feet on the floor anchor, crisp when the art allows.
 */
export function useWorldHdScale(character: WorldCustomCharacter): WorldHdScale & { grid: number; measured: boolean } {
 const src = character.hd3?.directions.s?.idle?.frames[0]?.src ?? character.hd?.idle[0];
 const [metrics, setMetrics] = useState<WorldFrameMetrics | null>(null);
 useEffect(() => { let live = true; setMetrics(null); if (src) void worldHdFrameMetrics(src).then(found => { if (live) setMetrics(found); }); return () => { live = false; }; }, [src]);
 const phone = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;
 const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
 const scale = worldHdScale({ metrics, height: character.hd3?.height, worldPixel: worldPixelSize(phone, dpr), devicePixelRatio: dpr });
 return { ...scale, grid: metrics?.grid ?? 1, measured: !!metrics };
}
/** CSS custom properties that place a scaled HD canvas on the floor anchor. */
export const worldHdScaleStyle = (scale: WorldHdScale) => ({ "--world-hd-size": scale.size + "px", "--world-hd-foot": scale.footOffset + "px" });

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
 const scale = useWorldHdScale(character);
 if (!src) return null;
 return <img className={"world-pal-hd-art" + (scale.grid > 1 ? " world-hd-crisp" : "")} src={src} width={256} height={256} draggable={false}
  style={{ width: scale.size, height: scale.size, ...worldHdScaleStyle(scale) } as CSSProperties} data-hd-grid={scale.grid}
  data-hd-crisp={scale.crisp} data-hd-height={scale.heightRatio} data-facing={selected?.direction ?? facing}
  data-hd-fallback={selected ? [selected.direction !== facing && "facing", selected.action !== kind && "clip"].filter(Boolean).join("+") || undefined : undefined}
  alt={name + " in " + character.name + " look"} />;
}
