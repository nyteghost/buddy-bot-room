import { useId, type CSSProperties } from "react";
import type { AgentId } from "@/lib/agents";
import { motionProfile, type PalMotion } from "@/lib/pal-motion";
import "./pal-motion.css";

// Reuse the original art as four adjoining layers. Browsers cache one image;
// only transforms animate. Portraits and native directional art keep their identity.
const parts = [
  { name: "head", x: 0, y: 0, w: 128, h: 58 },
  { name: "body", x: 0, y: 57, w: 128, h: 41 },
  { name: "left-leg", x: 0, y: 97, w: 64, h: 31 },
  { name: "right-leg", x: 64, y: 97, w: 64, h: 31 },
] as const;
export function PalArtRig({ id, art, motion, className }: { id: AgentId; art: string; motion: PalMotion; className: string }) {
  const key = useId().replace(/:/g, "");
  const profile = motionProfile(id);
  const style = { "--pal-gait": `${profile.gaitMs}ms`, "--pal-phase": `${profile.delayMs}ms`, "--pal-breathe": `${profile.breatheMs}ms` } as CSSProperties;
  return <svg viewBox="0 0 128 128" role="img" aria-label={`${id} pixel character`} className={className + " pal-rig"} data-pal-motion={motion} style={style}>
    <defs>{parts.map(p => <clipPath id={`${key}-${p.name}`} key={p.name}><rect x={p.x} y={p.y} width={p.w} height={p.h} /></clipPath>)}</defs>
    <g className="rig-pose">{parts.map(p => <g key={p.name} className={`rig-${p.name}`}>
      <g clipPath={`url(#${key}-${p.name})`}><image href={art} x="0" y="0" width="128" height="128" preserveAspectRatio="xMidYMid meet" /></g>
    </g>)}</g>
  </svg>;
}
