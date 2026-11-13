import { describe, expect, it } from "vitest";
import {
 WORLD_ISO_MAX_DEPTH_ITEMS, WORLD_ISO_MAX_PROP_TILES, WORLD_ISO_MAX_SLICES, worldIsoActorBox, worldIsoBehind, worldIsoDepthOrder, worldIsoDepthProblems, worldIsoSliceBox,
 type WorldIsoDepthItem,
} from "@/lib/world-iso-depth";

const prop = (id: string, u1: number, v1: number, u2: number, v2: number): WorldIsoDepthItem => ({ id, layer: "prop", box: { u1, v1, u2, v2 } });
const actor = (id: string, u: number, v: number): WorldIsoDepthItem => ({ id, layer: "actor", box: worldIsoActorBox({ u, v }) });
const before = (order: readonly string[], a: string, b: string) => order.indexOf(a) < order.indexOf(b);

describe("ground-box depth rule", () => {
 it("draws a box behind another when it ends before the other starts on either axis", () => {
  expect(worldIsoBehind({ u1: 0, v1: 0, u2: 1, v2: 1 }, { u1: 1, v1: 0, u2: 2, v2: 1 })).toBe(true);
  expect(worldIsoBehind({ u1: 0, v1: 0, u2: 1, v2: 1 }, { u1: 0, v1: 2, u2: 1, v2: 3 })).toBe(true);
  expect(worldIsoBehind({ u1: 1, v1: 0, u2: 2, v2: 1 }, { u1: 0, v1: 0, u2: 1, v2: 1 })).toBe(false);
 });

 it("keeps a character beside the FAR end of a long desk behind it (feet-height sorting gets this wrong)", () => {
  // Desk along u from 0 to 6; the character stands just behind its far end, but lower on screen than the desk's near end.
  const desk = prop("desk", 0, 2, 6, 3), pal = actor("pal", 5.5, 1.6);
  const { order } = worldIsoDepthOrder([pal, desk]);
  expect(order).toEqual(["pal", "desk"]);
 });

 it("draws a character in front of the desk when standing on its near side", () => {
  expect(worldIsoDepthOrder([prop("desk", 0, 2, 2, 3), actor("pal", 1, 3.5)]).order).toEqual(["desk", "pal"]);
 });

 it("seats a character between the chair behind and the desk in front", () => {
  const chair = prop("chair", 3.7, 0.9, 4.3, 1.2), desk = prop("desk", 3, 2, 5, 3), pal = actor("pal", 4, 1.3);
  const { order } = worldIsoDepthOrder([desk, pal, chair]);
  expect(order).toEqual(["chair", "pal", "desk"]);
 });

 it("passes behind and in front of a tall shelf", () => {
  const shelf = prop("shelf", 12, 6, 13, 6.5);
  expect(worldIsoDepthOrder([shelf, actor("behind", 12.5, 5.6)]).order).toEqual(["behind", "shelf"]);
  expect(worldIsoDepthOrder([shelf, actor("front", 12.5, 6.9)]).order).toEqual(["shelf", "front"]);
 });

 it("puts decals first and overhangs last regardless of position", () => {
  const items: WorldIsoDepthItem[] = [
   { id: "lamp", layer: "overhang", box: { u1: 0, v1: 0, u2: 0.5, v2: 0.5 } },
   actor("pal", 9, 9),
   { id: "rug", layer: "decal", box: { u1: 5, v1: 5, u2: 12, v2: 12 } },
   prop("sofa", 7, 8.6, 10, 9.6),
  ];
  const { order } = worldIsoDepthOrder(items);
  expect(order[0]).toBe("rug");
  expect(order.at(-1)).toBe("lamp");
 });

 it("gives the same order for any input order (stable, deterministic)", () => {
  const items = [prop("desk-a", 3, 2, 5, 3), prop("desk-b", 6.3, 2, 8.3, 3), actor("a", 4, 1.3), actor("b", 7.3, 1.3), actor("c", 5.6, 4), prop("shelf", 12, 6, 13, 6.5), actor("d", 12.5, 7)];
  const reference = worldIsoDepthOrder(items).order;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 25; k++) {
   const shuffled = [...items].sort(() => rand() - 0.5);
   expect(worldIsoDepthOrder(shuffled).order).toEqual(reference);
  }
 });

 it("never needs the cycle fallback for the grey-box style layouts", () => {
  const items: WorldIsoDepthItem[] = [];
  for (let i = 0; i < 9; i++) items.push(prop(`desk-${i}`, (i % 3) * 3.3 + 3, Math.floor(i / 3) * 3 + 2, (i % 3) * 3.3 + 5, Math.floor(i / 3) * 3 + 3));
  for (let i = 0; i < 15; i++) items.push(actor(`actor-${i}`, 0.7 + (i * 1.17) % 17, 0.9 + (i * 2.31) % 12));
  expect(worldIsoDepthOrder(items).cycles).toBe(0);
 });

 it("rejects duplicate ids", () => {
  let threw = false;
  try { worldIsoDepthOrder([actor("x", 1, 1), actor("x", 2, 2)]); } catch { threw = true; }
  expect(threw).toBe(true);
 });
});

describe("slicing long props", () => {
 it("splits a prop longer than three tiles into equal slices along its long axis", () => {
  const slices = worldIsoSliceBox({ id: "bench", u1: 0, v1: 0, u2: 7, v2: 1 });
  expect(slices.map(s => s.id)).toEqual(["bench#0", "bench#1", "bench#2"]);
  expect(slices[0]!.u1).toBe(0); expect(slices[2]!.u2).toBe(7);
  for (const s of slices) expect(s.u2 - s.u1).toBeLessThanOrEqual(WORLD_ISO_MAX_PROP_TILES);
 });

 it("leaves props of three tiles or less alone", () => {
  expect(worldIsoSliceBox({ id: "sofa", u1: 7, v1: 8.6, u2: 10, v2: 9.6 })).toEqual([{ id: "sofa", u1: 7, v1: 8.6, u2: 10, v2: 9.6 }]);
 });

 it("sorts a character correctly against each slice of a long counter", () => {
  const items = [...worldIsoSliceBox({ id: "counter", u1: 0, v1: 5, u2: 9, v2: 6 }).map(s => prop(s.id, s.u1, s.v1, s.u2, s.v2)), actor("pal", 7.5, 4.5)];
  const { order } = worldIsoDepthOrder(items);
  // The character stands behind the counter's far slice, which overlaps it on screen.
  expect(before(order, "pal", "counter#2")).toBe(true);
  expect(order).toHaveLength(4);
 });
});

// ---------- PM review (PR #40): determinism and stated limits ----------
describe("depth order: determinism and what it does not know", () => {
 it("orders overlapping (intersecting) boxes by the fallback key, the same way every time, without throwing", () => {
  const a = prop("a", 2, 2, 4, 4), b = prop("b", 3, 3, 5, 5), c = actor("inside", 3.5, 3.5);
  const reference = worldIsoDepthOrder([a, b, c]).order;
  expect(reference).toEqual(["a", "inside", "b"]);
  for (const items of [[c, b, a], [b, a, c], [a, c, b]]) expect(worldIsoDepthOrder(items).order).toEqual(reference);
 });

 it("breaks exact ties by id", () => {
  expect(worldIsoDepthOrder([actor("b", 3, 3), actor("a", 3, 3)]).order).toEqual(["a", "b"]);
  expect(worldIsoDepthOrder([actor("z", 2, 4), actor("y", 4, 2)]).order).toEqual(["y", "z"]); // same depth, far apart on screen
 });

 it("is a ground-footprint order only: it has no knowledge of sprite height or drawn extents", () => {
  // Two items whose footprints do not overlap on screen get no ordering constraint, however tall their art is.
  // Whether a tall shelf's picture covers a character standing two tiles to its side must be checked with real art.
  const shelf = prop("shelf", 2, 6, 3, 6.5), pal = actor("pal", 6, 3);
  const { order, cycles } = worldIsoDepthOrder([shelf, pal]);
  expect(cycles).toBe(0);
  expect(order).toHaveLength(2);
  expect(Object.keys(shelf.box).sort()).toEqual(["u1", "u2", "v1", "v2"]); // no height or pixel extent in the input
 });
});

// ---------- Final Step 1a hardening (Core + QA review of 2e1c9d1) ----------
const permutations = <T,>(xs: readonly T[]): T[][] => xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));
const overlap = (a: WorldIsoDepthItem["box"], b: WorldIsoDepthItem["box"]) => a.u1 < b.u2 && b.u1 < a.u2 && a.v1 < b.v2 && b.v1 < a.v2;
/** Two props crossing each other (invalid as colliders) plus two small props: a real ordering cycle. */
const CROSS = [prop("x", 0, 1, 4, 2), prop("y", 1, 0, 2, 4), prop("z", 2.2, 0, 3, 0.9), prop("w", 0, 2.2, 0.9, 3)];

describe("ordering cycles are predictable", () => {
 it("never cycles for valid boxes that do not intersect (2,000 random layouts, pinwheel included)", () => {
  const pinwheel = [prop("a", 0, 0, 2, 1), prop("b", 2, 0, 3, 2), prop("c", 1, 2, 3, 3), prop("d", 0, 1, 1, 3), actor("hub", 1.5, 1.5)];
  const wheel = worldIsoDepthOrder(pinwheel);
  expect(wheel.cycles).toBe(0);
  expect(wheel.order[0]).toBe("a"); expect(wheel.order.at(-1)).toBe("c");
  let seed = 4242;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 2000; k++) {
   const items: WorldIsoDepthItem[] = [];
   for (let t = 0; t < 40 && items.length < 7; t++) {
    const u = Math.floor(rand() * 16) / 2, v = Math.floor(rand() * 16) / 2, long = rand() < 0.5;
    const b = { u1: u, v1: v, u2: u + (long ? 0.5 + Math.floor(rand() * 6) / 2 : 0.5), v2: v + (long ? 0.5 : 0.5 + Math.floor(rand() * 6) / 2) };
    if (!items.some(i => overlap(i.box, b))) items.push({ id: `p${items.length}`, layer: "prop", box: b });
   }
   const result = worldIsoDepthOrder(items);
   if (result.cycles) throw new Error(`cycle in layout ${k}: ${JSON.stringify(items.map(i => i.box))}`);
   // The order respects every pairwise constraint.
   for (const a of items) for (const b of items) {
    if (a === b || !((a.box.u1 - a.box.v2) < (b.box.u2 - b.box.v1) - 1e-9 && (b.box.u1 - b.box.v2) < (a.box.u2 - a.box.v1) - 1e-9)) continue;
    if (worldIsoBehind(a.box, b.box) && !worldIsoBehind(b.box, a.box) && !before(result.order, a.id, b.id)) throw new Error(`layout ${k}: ${a.id} should be behind ${b.id}`);
   }
  }
 });

 it("breaks a real cycle (intersecting props) the same way for every input order, and names what it released", () => {
  const reference = worldIsoDepthOrder(CROSS);
  expect(reference.cycles).toBeGreaterThan(0);
  expect(reference.cycleIds).toHaveLength(reference.cycles);
  expect([...reference.order].sort()).toEqual(["w", "x", "y", "z"]);
  for (const id of reference.cycleIds) expect(["w", "x", "y", "z"]).toContain(id);
  for (const p of permutations(CROSS)) expect(worldIsoDepthOrder(p)).toEqual(reference);
  expect(worldIsoDepthOrder(CROSS)).toEqual(reference); // and again: no hidden state
 });

 it("reports no cycle ids when there is no cycle", () => {
  const result = worldIsoDepthOrder([prop("desk", 3, 2, 5, 3), actor("pal", 4, 1.3)]);
  expect(result.cycles).toBe(0); expect(result.cycleIds).toEqual([]); expect(result.invalidIds).toEqual([]); expect(result.overLimit).toBe(false);
 });
});

describe("long furniture segmentation", () => {
 it("slicing the two long crossing props removes the cycle", () => {
  const sliced = CROSS.flatMap(i => worldIsoSliceBox({ id: i.id, ...i.box }, 2).map(b => prop(b.id, b.u1, b.v1, b.u2, b.v2)));
  expect(sliced.map(i => i.id).sort()).toEqual(["w", "x#0", "x#1", "y#0", "y#1", "z"]);
  const result = worldIsoDepthOrder(sliced);
  expect(result.cycles).toBe(0);
  expect(before(result.order, "y#0", "z") && before(result.order, "z", "x#1")).toBe(true);
  expect(before(result.order, "x#0", "w") && before(result.order, "w", "y#1")).toBe(true);
 });

 it("slices tile the original box exactly: no gap, no overlap, same outline, along either axis", () => {
  for (const box of [{ id: "bench", u1: 0.5, v1: 2, u2: 10.7, v2: 3 }, { id: "wall-unit", u1: 4, v1: 1.25, u2: 4.5, v2: 9 }]) {
   const slices = worldIsoSliceBox(box), alongU = box.u2 - box.u1 >= box.v2 - box.v1;
   expect(slices.length).toBeGreaterThan(1);
   expect(alongU ? slices[0]!.u1 : slices[0]!.v1).toBe(alongU ? box.u1 : box.v1);
   expect(alongU ? slices.at(-1)!.u2 : slices.at(-1)!.v2).toBe(alongU ? box.u2 : box.v2);
   for (let k = 0; k < slices.length; k++) {
    const s = slices[k]!;
    expect(s.id).toBe(`${box.id}#${k}`);
    expect(alongU ? [s.v1, s.v2] : [s.u1, s.u2]).toEqual(alongU ? [box.v1, box.v2] : [box.u1, box.u2]);
    expect((alongU ? s.u2 - s.u1 : s.v2 - s.v1)).toBeLessThanOrEqual(WORLD_ISO_MAX_PROP_TILES + 1e-9);
    expect((alongU ? s.u2 - s.u1 : s.v2 - s.v1)).toBeGreaterThan(0);
    if (k) expect(alongU ? s.u1 : s.v1).toBe(alongU ? slices[k - 1]!.u2 : slices[k - 1]!.v2);
   }
  }
 });

 it("orders characters correctly against each end of a sliced long counter", () => {
  const slices = worldIsoSliceBox({ id: "counter", u1: 0, v1: 5, u2: 9, v2: 6 }).map(s => prop(s.id, s.u1, s.v1, s.u2, s.v2));
  const { order, cycles } = worldIsoDepthOrder([...slices, actor("behind-far", 8.5, 4.5), actor("front-far", 8.5, 6.5), actor("behind-near", 0.5, 4.5), actor("front-near", 0.5, 6.5)]);
  expect(cycles).toBe(0);
  expect(before(order, "behind-far", "counter#2") && before(order, "counter#2", "front-far")).toBe(true);
  expect(before(order, "behind-near", "counter#0") && before(order, "counter#0", "front-near")).toBe(true);
 });

 it("handles a bad slice size or a bad box safely, and never returns a huge list", () => {
  const box = { id: "bench", u1: 0, v1: 0, u2: 7, v2: 1 };
  for (const max of [0, -1, Number.NaN, Infinity, -Infinity]) expect(worldIsoSliceBox(box, max)).toEqual([box]);
  for (const bad of [{ id: "n", u1: Number.NaN, v1: 0, u2: 7, v2: 1 }, { id: "i", u1: 0, v1: 0, u2: Infinity, v2: 1 }, { id: "f", u1: 7, v1: 0, u2: 0, v2: 1 }]) expect(worldIsoSliceBox(bad)).toEqual([bad]);
  const many = worldIsoSliceBox({ id: "huge", u1: 0, v1: 0, u2: 1e9, v2: 1 }, 0.001);
  expect(many).toHaveLength(WORLD_ISO_MAX_SLICES);
  expect(many[0]!.u1).toBe(0); expect(many.at(-1)!.u2).toBe(1e9);
 });
});

describe("draw items are checked without crashing the draw loop", () => {
 const bad = (id: string, box: unknown, layer: unknown = "prop") => ({ id, layer, box }) as unknown as WorldIsoDepthItem;
 const codes = (items: unknown) => worldIsoDepthProblems(items).map(p => p.code);

 it("names each kind of problem in words and never throws", () => {
  expect(codes([prop("a", 0, 0, 1, 1), prop("a", 2, 2, 3, 3)])).toContain("duplicate-id");
  expect(codes([bad("nan", { u1: Number.NaN, v1: 0, u2: 1, v2: 1 })])).toContain("box-invalid");
  expect(codes([bad("inf", { u1: 0, v1: 0, u2: Infinity, v2: 1 })])).toContain("box-invalid");
  expect(codes([bad("flipped", { u1: 2, v1: 0, u2: 1, v2: 1 })])).toContain("box-invalid");
  expect(codes([bad("flat", { u1: 0, v1: 1, u2: 1, v2: 1 })])).toContain("box-invalid");
  expect(codes([bad("none", null)])).toContain("box-invalid");
  expect(codes([bad("layer", { u1: 0, v1: 0, u2: 1, v2: 1 }, "ceiling")])).toContain("layer-unknown");
  expect(codes([prop("long", 0, 0, 7, 1)])).toContain("prop-too-long");
  expect(codes([{ id: "rug", layer: "decal", box: { u1: 0, v1: 0, u2: 9, v2: 9 } }])).toEqual([]); // decals may be large
  expect(codes([null, 7, { layer: "prop" }])).toEqual(["item-invalid", "item-invalid", "item-invalid"]);
  expect(codes("nope")).toEqual(["item-invalid"]);
  expect(codes(Array.from({ length: WORLD_ISO_MAX_DEPTH_ITEMS + 1 }, (_, i) => actor(`a${i}`, i % 19, i % 14)))).toContain("too-many-items");
  expect(codes([prop("desk", 3, 2, 5, 3), actor("pal", 4, 1.3)])).toEqual([]);
  for (const p of worldIsoDepthProblems([bad("x", null, "nope"), prop("long", 0, 0, 7, 1)])) expect(p.message.length).toBeGreaterThan(20);
 });

 it("orders valid items normally and draws invalid ones after them, in id order, for any input order", () => {
  const items = [bad("zz-nan", { u1: Number.NaN, v1: 0, u2: 1, v2: 1 }), prop("desk", 3, 2, 5, 3), bad("aa-layer", { u1: 0, v1: 0, u2: 1, v2: 1 }, "ceiling"),
   actor("pal", 4, 1.3), bad("mm-flipped", { u1: 5, v1: 5, u2: 4, v2: 6 }), { id: "lamp", layer: "overhang", box: { u1: 0, v1: 0, u2: 1, v2: 1 } } as WorldIsoDepthItem];
  const reference = worldIsoDepthOrder(items);
  expect(reference.order).toEqual(["pal", "desk", "aa-layer", "mm-flipped", "zz-nan", "lamp"]);
  expect(reference.invalidIds).toEqual(["aa-layer", "mm-flipped", "zz-nan"]);
  expect(reference.cycles).toBe(0);
  for (const p of permutations(items).slice(0, 120)) expect(worldIsoDepthOrder(p)).toEqual(reference);
 });

 it("ignores entries that are not items at all, and accepts a non-list as empty", () => {
  expect(worldIsoDepthOrder([null, 5, actor("pal", 1, 1)] as unknown as WorldIsoDepthItem[]).order).toEqual(["pal"]);
  expect(worldIsoDepthOrder("nope" as unknown as WorldIsoDepthItem[]).order).toEqual([]);
 });

 it("above the item limit, falls back to key order without the pairwise pass and says so", () => {
  const items = Array.from({ length: WORLD_ISO_MAX_DEPTH_ITEMS + 8 }, (_, i) => actor(`a${String(i).padStart(4, "0")}`, (i * 7) % 19 + 0.5, (i * 11) % 14 + 0.5));
  const result = worldIsoDepthOrder(items);
  expect(result.overLimit).toBe(true);
  expect(result.order).toHaveLength(items.length);
  expect(new Set(result.order).size).toBe(items.length);
  expect(worldIsoDepthOrder([...items].reverse())).toEqual(result);
 });
});

describe("depth sort cost at the planned scene size", () => {
 it("sorts 15 characters and 40 props deterministically in well under a frame", () => {
  const items: WorldIsoDepthItem[] = [];
  for (let i = 0; i < 40; i++) { const u = (i % 8) * 2.3 + 0.2, v = Math.floor(i / 8) * 2.6 + 0.4; items.push(prop(`prop-${i}`, u, v, u + (i % 3 ? 2 : 1), v + (i % 3 ? 1 : 2))); }
  for (let i = 0; i < 15; i++) items.push(actor(`actor-${i}`, 0.31 + (i * 1.23) % 18, 0.17 + (i * 2.61) % 13));
  const reference = worldIsoDepthOrder(items);
  expect(reference.cycles).toBe(0);
  expect(reference.order).toHaveLength(55);
  const runs = 50, start = performance.now();
  for (let k = 0; k < runs; k++) if (worldIsoDepthOrder(k % 2 ? items : [...items].reverse()).order.join() !== reference.order.join()) throw new Error("order changed between runs");
  expect((performance.now() - start) / runs).toBeLessThan(5); // generous: a slow CI machine still passes; typical is far lower
 });
});
