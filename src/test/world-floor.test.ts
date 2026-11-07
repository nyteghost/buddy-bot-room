import {describe,expect,it} from "vitest";
import {characterModes} from "@/lib/hellraiser";
import {WORLD_FIXTURE_KINDS,worldDepthScale,worldDepthZ,worldHeadingOf,worldPath,worldPointIsWalkable,worldRoomPlan,worldSegmentClear,worldSmoothPath,worldSnap} from "@/lib/world-floor";

describe("Living World calibrated floor plans",()=>{
 it("gives every theme open homes, visits and reachable furniture spots",()=>{
  for(const theme of characterModes){
   const plan=worldRoomPlan(theme);
   expect(plan.homes).toHaveLength(9);
   expect(plan.visits).toHaveLength(9);
   expect(plan.fixtures.length).toBeGreaterThanOrEqual(4);
   for(const spot of [...plan.homes,...plan.visits]){
    const snapped=worldSnap(spot,theme)!;
    expect(worldPointIsWalkable(snapped,theme)).toBe(true);
    // Authored spots are on the floor grid itself or within one cell of it.
    expect(Math.hypot(snapped.x-spot.x,snapped.y-spot.y)).toBeLessThanOrEqual(3);
   }
   for(const fixture of plan.fixtures){
    expect(WORLD_FIXTURE_KINDS).toContain(fixture.kind);
    const stand=worldSnap(fixture.stand,theme)!;
    expect(Math.hypot(stand.x-fixture.stand.x,stand.y-fixture.stand.y)).toBeLessThanOrEqual(3);
    expect(fixture.glow.x).toBeGreaterThanOrEqual(0);expect(fixture.glow.x).toBeLessThanOrEqual(100);
    expect(fixture.glow.y).toBeGreaterThanOrEqual(0);expect(fixture.glow.y).toBeLessThanOrEqual(100);
   }
   expect(new Set(plan.fixtures.map(fixture=>fixture.id)).size).toBe(plan.fixtures.length);
  }
 });
 it("blocks the furniture the backdrops actually show",()=>{
  // Feet on the common-room table top, in the DCC stairwell pool and on the Matrix console table are not floor.
  expect(worldPointIsWalkable({x:50,y:48},"normal")).toBe(false);
  expect(worldPointIsWalkable({x:40,y:66},"normal")).toBe(false);
  expect(worldPointIsWalkable({x:77,y:52},"dcc")).toBe(false);
  expect(worldPointIsWalkable({x:50,y:57},"matrix")).toBe(false);
  expect(worldPointIsWalkable({x:50,y:60},"finalfantasy")).toBe(false);
  expect(worldPointIsWalkable({x:50,y:60},"cyberpunk")).toBe(false);
  // Open floor in front of each.
  expect(worldPointIsWalkable({x:51,y:80},"normal")).toBe(true);
  expect(worldPointIsWalkable({x:77,y:68},"dcc")).toBe(true);
 });
 it("checks straight strides exactly, including clipped furniture corners",()=>{
  expect(worldSegmentClear({x:84,y:62},{x:63,y:74},"finalfantasy")).toBe(false);
  expect(worldSegmentClear({x:21,y:77},{x:78,y:77},"normal")).toBe(true);
  expect(worldSegmentClear({x:21,y:77},{x:78,y:41},"normal")).toBe(false);
 });
 it("string-pulls grid paths into fewer straight strides that stay clear",()=>{
  for(const theme of characterModes){
   const plan=worldRoomPlan(theme);
   for(let i=0;i<plan.homes.length;i++){
    const raw=worldPath(plan.homes[i]!,plan.visits[(i+3)%9]!,theme);
    if(raw.length<2)continue;
    const smooth=worldSmoothPath(raw,theme);
    expect(smooth.length).toBeLessThanOrEqual(raw.length);
    expect(smooth[0]).toEqual(raw[0]);expect(smooth[smooth.length-1]).toEqual(raw[raw.length-1]);
    for(let k=1;k<smooth.length;k++)expect(worldSegmentClear(smooth[k-1]!,smooth[k]!,theme)).toBe(true);
   }
  }
 });
 it("orders depth and perspective from the feet",()=>{
  expect(worldDepthZ(80)).toBeGreaterThan(worldDepthZ(40));
  expect(worldDepthZ(Number.NaN)).toBe(60);
  expect(worldDepthZ(500)).toBe(110);
  expect(worldDepthScale(35)).toBeCloseTo(0.86);
  expect(worldDepthScale(88)).toBeCloseTo(1);
  expect(worldDepthScale(60)).toBeGreaterThan(worldDepthScale(40));
 });
 it("faces the way a move looks on screen (vertical percentages are shorter)",()=>{
  expect(worldHeadingOf(10,0)).toBe("e");
  expect(worldHeadingOf(0,-5)).toBe("n");
  expect(worldHeadingOf(-10,3)).toBe("w");
  expect(worldHeadingOf(-4,6)).toBe("sw");
  expect(worldHeadingOf(3,-8)).toBe("ne");
  expect(worldHeadingOf(0,0)).toBe("s");
 });
});
