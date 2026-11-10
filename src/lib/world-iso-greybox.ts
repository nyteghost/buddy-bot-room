import type { WorldHdDirection } from "./world-hd";
import { worldIsoGroundFacing } from "./world-iso-facing";
import { worldIsoSealPlan, type GroundAnchor, type GroundAnchorKind, type GroundBox, type GroundPlan } from "./world-iso-ground";
import { WORLD_ISO_FLOOR, worldIsoProjection, type GroundPoint } from "./world-iso-projection";

/**
 * Living Universe — isometric ground engine (Step 1a): the synthetic grey-box Office plan.
 *
 * Coordinates only, written by Claude for engine tests and the later grey-box review. It contains no
 * artwork and is not the designer's layout (that arrives later as a private, reviewed room pack).
 * It follows the approved contract and the Gate 0 corrections:
 * - 19 × 14 tile floor, back walls along u = 0 (shelves) and v = 0 (windows), open front edges;
 * - nine 2 × 1 desks in three banks, at least 1.2 tiles apart within a bank;
 * - chairs on the WALL side, so seated Pals face the viewer: north bank SW, library and systems banks SE;
 * - every seat has a front prop (its desk) and a standing fallback for characters without sitting art;
 * - six visitor homes outside the work block, four chat pairs, sofa, coffee, window, board, shelf, plant;
 * - anchor ids match today's flat HD office (`seat-0`…`seat-8`, `sofa-1`…, `chat-a1`…), so schedules and
 *   the Pal-to-desk mapping carry over without migration.
 */
const iso = worldIsoProjection();
const p = (u: number, v: number): GroundPoint => ({ u, v });
const box = (id: string, u1: number, v1: number, u2: number, v2: number): GroundBox => ({ id, u1, v1, u2, v2 });
const facingTo = (from: GroundPoint, to: GroundPoint): WorldHdDirection => worldIsoGroundFacing(iso, from, to);
const anchor = (id: string, kind: GroundAnchorKind, at: GroundPoint, facing: WorldHdDirection, extra: Partial<GroundAnchor> = {}): GroundAnchor => ({ id, kind, at, facing, ...extra });

type Bank = "north" | "library" | "systems";
/** Desk centre and bank, in Pal order (desk index 0 = Nova). */
const DESKS: readonly (readonly [Bank, number, number])[] = [
 ["north", 4, 2.5], ["north", 7.3, 2.5], ["north", 10.6, 2.5],
 ["library", 2.5, 5.3], ["library", 2.5, 8.5], ["library", 2.5, 11.7],
 ["systems", 15.5, 4], ["systems", 15.5, 7.2], ["systems", 15.5, 10.4],
];
const SEAT_GAP = 0.7; // seat point to desk edge
const STAND_OFFSET = 1.65; // standing fallback: along the bank, into the gap past the desk end

const deskBoxes: GroundBox[] = [], deskAnchors: GroundAnchor[] = [];
DESKS.forEach(([bank, u, v], i) => {
 // North-bank desks run along u (window wall); the others run along v.
 const d = bank === "north" ? box(`desk-${i}`, u - 1, v - 0.5, u + 1, v + 0.5) : box(`desk-${i}`, u - 0.5, v - 1, u + 0.5, v + 1);
 deskBoxes.push(d);
 const seat = bank === "north" ? p(u, d.v1 - SEAT_GAP) : p(d.u1 - SEAT_GAP, v);
 const stand = bank === "north" ? p(u + STAND_OFFSET, seat.v) : p(seat.u, v + STAND_OFFSET);
 const centre = p(u, v);
 deskAnchors.push(
  anchor(`seat-${i}`, "seat", seat, facingTo(seat, centre), { desk: i, front: d.id, standFallback: `stand-desk-${i}` }),
  anchor(`stand-desk-${i}`, "stand", stand, facingTo(stand, centre), { desk: i }),
 );
});

const COLLIDERS: readonly GroundBox[] = [
 ...deskBoxes,
 box("sofa", 7, 8.6, 10, 9.6),
 box("coffee-table", 7.8, 11.2, 9.2, 11.8),
 box("coffee-counter", 12.8, 0, 15.6, 0.8),
 box("shelf-tall", 12, 6, 13, 6.5),
 box("plant", 17.6, 12.6, 18.4, 13.4),
];

const pair = (id: string, u: number, v: number): GroundAnchor[] =>
 // Conversation partners stand along the screen-horizontal line, facing each other in profile (e / w).
 [anchor(`${id}1`, "chat", p(u, v), "e"), anchor(`${id}2`, "chat", p(u + 1, v - 1), "w")];

const ANCHORS: readonly GroundAnchor[] = [
 ...deskAnchors,
 anchor("door", "door", p(12, 13.6), "n"),
 anchor("sofa-1", "sofa", p(7.5, 10.2), "sw"), anchor("sofa-2", "sofa", p(8.5, 10.2), "sw"), anchor("sofa-3", "sofa", p(9.5, 10.2), "sw"),
 anchor("coffee-1", "coffee", p(13.2, 1.5), "ne"), anchor("coffee-2", "coffee", p(14.2, 1.5), "ne"), anchor("coffee-3", "coffee", p(15.2, 1.5), "ne"),
 anchor("window-1", "window", p(11.9, 0.5), "ne"), anchor("window-2", "window", p(17.5, 1.0), "ne"),
 anchor("board-1", "board", p(0.9, 1.0), "nw"), anchor("board-2", "board", p(0.9, 2.0), "nw"), anchor("board-3", "board", p(0.9, 3.0), "nw"),
 anchor("shelf-1", "shelf", p(12.5, 7.1), "ne"), anchor("shelf-2", "shelf", p(12.5, 5.4), "sw"),
 anchor("plant-1", "plant", p(17.0, 13.0), "e"),
 ...pair("chat-a", 10.6, 8.2), ...pair("chat-b", 5.5, 12.5), ...pair("chat-c", 16.5, 12.6), ...pair("chat-d", 8, 4.6),
 anchor("visitor-home-0", "visitor", p(6.0, 6.5), "s"), anchor("visitor-home-1", "visitor", p(9.5, 6.0), "s"),
 anchor("visitor-home-2", "visitor", p(13.2, 9.5), "s"), anchor("visitor-home-3", "visitor", p(5.0, 9.8), "s"),
 anchor("visitor-home-4", "visitor", p(11.5, 11.5), "s"), anchor("visitor-home-5", "visitor", p(8.5, 13.0), "s"),
];

const SEALED = worldIsoSealPlan({
 id: "office-iso-greybox",
 floor: [p(0, 0), p(WORLD_ISO_FLOOR.u, 0), p(WORLD_ISO_FLOOR.u, WORLD_ISO_FLOOR.v), p(0, WORLD_ISO_FLOOR.v)],
 colliders: COLLIDERS,
 anchors: ANCHORS,
 door: "door",
});
if (!SEALED) throw new Error("The grey-box Office plan failed its own geometry checks.");
/** Sealed (validated, deep-frozen) grey-box plan. */
export const WORLD_ISO_GREYBOX: GroundPlan = SEALED;
/** Pairs of chat anchor ids, as in the flat office. */
export const WORLD_ISO_GREYBOX_CHAT_PAIRS: readonly (readonly [string, string])[] = [["chat-a1", "chat-a2"], ["chat-b1", "chat-b2"], ["chat-c1", "chat-c2"], ["chat-d1", "chat-d2"]];
