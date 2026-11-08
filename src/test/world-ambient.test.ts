import { describe, expect, it } from "vitest";
import { AMBIENT_FORBIDDEN_WORDS, AMBIENT_PERIOD, ambientDescription, ambientPose, ambientSchedule, type AmbientActivity, type AmbientActor } from "@/lib/world-ambient";
import { HD_OFFICE_CHAT_PAIRS, HD_OFFICE_DESKS, HD_OFFICE_PROPS, HD_OFFICE_SPOTS, hdOfficeFloor } from "@/lib/world-hd-office";
import { worldPath, worldPointIsWalkable, worldRegisterLabPlan, worldScreenDistance } from "@/lib/world-floor";

const PALS = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"];
const cast = (visitors = 6): AmbientActor[] => [
 ...PALS.map((id, i): AmbientActor => ({ id: "pal:" + id, name: id, kind: "pal", home: "seat-" + i, speed: 5 })),
 ...Array.from({ length: visitors }, (_, i): AmbientActor => ({ id: "custom:v" + i, name: "Visitor " + i, kind: "visitor", home: ["sofa-1", "sofa-3", "window-1", "coffee-1", "board-1", "shelf-1"][i]!, speed: 5 })),
];
const schedule = (night = false, visitors = 6) => ambientSchedule({ theme: hdOfficeFloor(), actors: cast(visitors), spots: HD_OFFICE_SPOTS, chatPairs: HD_OFFICE_CHAT_PAIRS, seed: "test", night });

describe("Living Universe HD office layout", () => {
 it("registers its own floor without touching any room theme", () => {
  expect(hdOfficeFloor()).toBe("hd-office");
  expect(() => worldRegisterLabPlan("linux", { bounds: { x1: 0, y1: 0, x2: 1, y2: 1 }, obstacles: [], homes: [], visits: [], fixtures: [] })).toThrow();
 });
 it("has one workstation per Pal and every activity spot on open, connected floor", () => {
  const floor = hdOfficeFloor();
  expect(HD_OFFICE_DESKS).toHaveLength(9);
  expect(HD_OFFICE_SPOTS.filter(s => s.kind === "desk")).toHaveLength(9);
  for (const s of HD_OFFICE_SPOTS) expect(worldPointIsWalkable(s.point, floor)).toBe(true);
  const desk = HD_OFFICE_SPOTS[0]!.point;
  for (const s of HD_OFFICE_SPOTS) if (worldScreenDistance(desk, s.point) > 4) expect(worldPath(desk, s.point, floor).length).toBeGreaterThan(1);
  for (const p of HD_OFFICE_PROPS) { expect(p.top).toBeLessThan(p.foot.y2); expect(p.foot.x1).toBeLessThan(p.foot.x2); }
 });
});

describe("Ambient life: calm, coordinated and honest", () => {
 it("is deterministic and loops seamlessly", () => {
  const a = schedule(), b = schedule();
  for (const [id, plan] of a) {
   expect(JSON.stringify(plan)).toBe(JSON.stringify(b.get(id)));
   const start = ambientPose(plan, 0), end = ambientPose(plan, AMBIENT_PERIOD - 1);
   expect(worldScreenDistance(start, end)).toBeLessThan(0.5);
  }
 });
 it("spends most time somewhere, walks only between stays at walking speed, and Pals keep returning to their desk", () => {
  const plans = schedule();
  let walking = 0, total = 0, desk = 0, palTime = 0, maxSpeed = 0, offFloor = 0;
  for (const [id, plan] of plans) {
   let prev = ambientPose(plan, 0);
   for (let t = 500; t < AMBIENT_PERIOD; t += 500) {
    const p = ambientPose(plan, t);
    total++; if (p.walking) walking++;
    if (id.startsWith("pal:")) { palTime++; if (p.activity === "desk") desk++; }
    maxSpeed = Math.max(maxSpeed, worldScreenDistance(prev, p) / 0.5);
    if (!worldPointIsWalkable(p, hdOfficeFloor())) offFloor++;
    prev = p;
   }
  }
  expect(walking / total).toBeLessThan(0.25);
  expect(desk / palTime).toBeGreaterThan(0.2);
  expect(maxSpeed).toBeLessThanOrEqual(5 * 1.02);
  expect(offFloor / total).toBeLessThan(0.002);
 });
 it("schedules conversations for two characters at facing spots at the same time", () => {
  const plans = schedule();
  const chats = [...plans.values()].flatMap(p => p.segments.filter(s => s.kind === "stay" && s.activity === "chat").map(s => ({ id: p.id, s })));
  expect(chats.length).toBeGreaterThan(4);
  for (const { id, s } of chats) {
   if (s.kind !== "stay") continue;
   const partner = plans.get(s.partner!)!;
   const mid = (s.start + s.end) / 2;
   expect(partner.segments.some(o => o.kind === "stay" && o.activity === "chat" && o.partner === id && o.start <= mid + 10_000 && o.end >= mid - 10_000)).toBe(true);
  }
 });
 it("brings longer rests at night", () => {
  const share = (night: boolean) => {
   let rest = 0, all = 0;
   for (const plan of schedule(night).values()) for (let t = 0; t < AMBIENT_PERIOD; t += 1000) { all++; if (ambientPose(plan, t).activity === "rest") rest++; }
   return rest / all;
  };
  expect(share(true)).toBeGreaterThan(share(false));
 });
 it("never describes ambient behaviour as real AI work", () => {
  const activities: AmbientActivity[] = ["desk", "relax", "coffee", "window", "board", "shelf", "rest", "stretch", "chat", "plant"];
  for (const a of [...activities, "walk" as const]) {
   const text = ambientDescription(a, "Nova").toLowerCase();
   for (const word of AMBIENT_FORBIDDEN_WORDS) expect(text).not.toContain(word);
  }
  expect(ambientDescription("desk")).toBe("at their desk");
 });
 it("handles an empty room and a single actor", () => {
  expect(schedule(false, 0).size).toBe(9);
  const solo = ambientSchedule({ theme: hdOfficeFloor(), actors: cast(0).slice(0, 1), spots: HD_OFFICE_SPOTS, chatPairs: HD_OFFICE_CHAT_PAIRS });
  expect(solo.get("pal:nova")!.segments.length).toBeGreaterThan(2);
 });
});
