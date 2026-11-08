import type { CharacterMode } from "./hellraiser";
import type { Heading } from "./office-motion";
import { worldRegisterLabPlan, type WorldObstacle, type WorldPoint } from "./world-floor";

/**
 * Living Universe HD — Office / Linux (feature-flagged preview).
 *
 * A larger, layered office world: a background (walls, floor) plus separate furniture pieces, each with
 * a floor footprint (blocks feet) and a drawing height. Characters are drawn in front of or behind a piece
 * by comparing feet with the footprint's bottom edge, so the floor behind desks and the sofa is usable.
 * All art is synthetic (drawn in code) until the Character/Environment Designer supplies approved assets.
 * Coordinates are feet positions in percent of the world (x of width, y of height).
 */
export const HD_OFFICE_WORLD = { width: 2752, height: 1600 } as const;
/** A 256×256 character frame is drawn over this many world px; figure ≈ 0.92 of it. */
export const HD_OFFICE_ACTOR_PX = 192;
/** Camera never enlarges painted 256 art beyond 1.25 device px per art px on a 2× screen. */
export const HD_OFFICE_MAX_ZOOM = 0.85;
/** Crowd footprint for an adult at this scale (percent of the world). */
export const HD_OFFICE_FOOTPRINT = { rx: 1.4, ry: 0.8 } as const;

export type HdOfficeDraw = "desk" | "sofa" | "table" | "counter" | "shelf" | "plant" | "board" | "window" | "door" | "printer";
export type HdOfficeProp = Readonly<{ id: string; label: string; draw: HdOfficeDraw; foot: WorldObstacle; top: number; desk?: number }>;
export type HdOfficeSpotKind = "desk" | "sofa" | "coffee" | "window" | "board" | "shelf" | "chat" | "plant";
export type HdOfficeSpot = Readonly<{ id: string; kind: HdOfficeSpotKind; point: WorldPoint; facing: Heading; desk?: number }>;

const r = (x1: number, y1: number, x2: number, y2: number, label: string): WorldObstacle => ({ x1, y1, x2, y2, label });
const DESK_COLUMNS = [14, 30, 46], DESK_ROWS = [44, 61, 78];
/** Nine workstations, one per original Pal (index = Pal order). Seat point is in front of the desk, facing it. */
export const HD_OFFICE_DESKS: readonly HdOfficeProp[] = DESK_ROWS.flatMap((row, ri) => DESK_COLUMNS.map((x, ci) => ({
 id: `desk-${ri * 3 + ci}`, label: "workstation", draw: "desk" as const, foot: r(x - 5, row - 4, x + 5, row, "workstation"), top: row - 8.5, desk: ri * 3 + ci,
})));
export const HD_OFFICE_PROPS: readonly HdOfficeProp[] = [
 ...HD_OFFICE_DESKS,
 { id: "sofa", label: "sofa", draw: "sofa", foot: r(66, 47, 84, 52, "sofa"), top: 41 },
 { id: "coffee-table", label: "coffee table", draw: "table", foot: r(70, 60, 80, 64, "coffee table"), top: 57.5 },
 { id: "kitchen", label: "kitchenette", draw: "counter", foot: r(62, 27, 80, 31, "kitchenette"), top: 21.5 },
 { id: "shelf", label: "bookshelf", draw: "shelf", foot: r(3, 27, 9, 31, "bookshelf"), top: 11 },
 { id: "printer", label: "printer", draw: "printer", foot: r(55, 27, 59, 31, "printer"), top: 23 },
 { id: "plant-a", label: "plant", draw: "plant", foot: r(91, 70, 94, 73, "plant"), top: 62 },
 { id: "plant-b", label: "plant", draw: "plant", foot: r(58, 86, 61, 89, "plant"), top: 79 },
];
/** Wall art with no floor footprint (drawn in the background layer). */
export const HD_OFFICE_WALL = [
 { id: "board", label: "whiteboard", draw: "board" as const, x1: 24, x2: 46, y1: 8, y2: 22 },
 { id: "window-a", label: "window", draw: "window" as const, x1: 83, x2: 91, y1: 5, y2: 22 },
 { id: "window-b", label: "window", draw: "window" as const, x1: 92, x2: 99, y1: 5, y2: 22 },
 { id: "door", label: "door", draw: "door" as const, x1: 48, x2: 53, y1: 6, y2: 28 },
];
const s = (id: string, kind: HdOfficeSpotKind, x: number, y: number, facing: Heading, desk?: number): HdOfficeSpot =>
 ({ id, kind, point: { x, y }, facing, ...(desk === undefined ? {} : { desk }) });
export const HD_OFFICE_SPOTS: readonly HdOfficeSpot[] = [
 ...HD_OFFICE_DESKS.map(d => s("seat-" + d.desk, "desk", (d.foot.x1 + d.foot.x2) / 2, d.foot.y2 + 2.6, "n", d.desk)),
 s("sofa-1", "sofa", 69.5, 54, "s"), s("sofa-2", "sofa", 75, 54, "s"), s("sofa-3", "sofa", 80.5, 54, "s"),
 s("coffee-1", "coffee", 65, 34, "n"), s("coffee-2", "coffee", 71, 34, "n"), s("coffee-3", "coffee", 77, 34, "n"),
 s("window-1", "window", 87, 33, "n"), s("window-2", "window", 95, 33, "n"),
 s("board-1", "board", 29, 33, "n"), s("board-2", "board", 35, 33, "n"), s("board-3", "board", 41, 33, "n"),
 s("shelf-1", "shelf", 6, 35, "n"), s("shelf-2", "shelf", 12, 35, "n"),
 s("plant-1", "plant", 88, 76, "e"),
 // Conversation pairs: two spots facing each other.
 s("chat-a1", "chat", 69, 72, "e"), s("chat-a2", "chat", 75, 72, "w"),
 s("chat-b1", "chat", 84, 84, "e"), s("chat-b2", "chat", 90, 84, "w"),
 s("chat-c1", "chat", 26, 90, "e"), s("chat-c2", "chat", 32, 90, "w"),
 s("chat-d1", "chat", 63, 42, "e"), s("chat-d2", "chat", 69, 42, "w"),
];
/** Pairs of chat spots (ids). */
export const HD_OFFICE_CHAT_PAIRS: readonly (readonly [string, string])[] = [["chat-a1", "chat-a2"], ["chat-b1", "chat-b2"], ["chat-c1", "chat-c2"], ["chat-d1", "chat-d2"]];

/** Registers (once) and returns the floor key the crowd, wander and ambient code use for this world. */
let key: CharacterMode | null = null;
export function hdOfficeFloor(): CharacterMode {
 if (key) return key;
 key = worldRegisterLabPlan("hd-office", {
  bounds: { x1: 2, y1: 30, x2: 98, y2: 96 },
  obstacles: HD_OFFICE_PROPS.map(p => p.foot),
  homes: HD_OFFICE_SPOTS.filter(x => x.kind === "desk").map(x => x.point),
  visits: HD_OFFICE_SPOTS.filter(x => x.kind !== "desk").map(x => x.point),
  fixtures: [],
 });
 return key;
}
