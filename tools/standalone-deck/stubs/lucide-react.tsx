// Just the three icons the planner uses, so the one-file build needs no icon library.
import type { SVGProps } from "react";
const base = (p: SVGProps<SVGSVGElement>) => ({ xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...p });
export const Move = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" x2="22" y1="12" y2="12" /><line x1="12" x2="12" y1="2" y2="22" /></svg>);
export const RotateCcw = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>);
export const RotateCw = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>);
