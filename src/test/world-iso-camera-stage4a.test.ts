import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen } from "@/lib/world-camera";
import { WORLD_ISO_CANVAS } from "@/lib/world-iso-projection";
import { worldIsoCameraFit, worldIsoCameraClamp, worldIsoCameraPan, worldIsoCameraZoomAt,
 worldIsoCameraPinch, worldIsoCameraFollow } from "@/lib/world-iso-camera";

describe("Stage 4A contain-fit isometric camera", () => {
 for (const viewport of [{width:1650,height:927},{width:940,height:700},{width:750,height:650}]) {
  it("fits all world corners without cropping at "+viewport.width+"x"+viewport.height, () => {
   const camera = worldIsoCameraFit(viewport);
   for (const p of [{x:0,y:0},{x:WORLD_ISO_CANVAS.width,y:0},{x:0,y:WORLD_ISO_CANVAS.height},{x:WORLD_ISO_CANVAS.width,y:WORLD_ISO_CANVAS.height}]) {
    const screen = worldToScreen(camera,viewport,p);
    expect(screen.x).toBeGreaterThanOrEqual(-0.001);expect(screen.x).toBeLessThanOrEqual(viewport.width+0.001);
    expect(screen.y).toBeGreaterThanOrEqual(-0.001);expect(screen.y).toBeLessThanOrEqual(viewport.height+0.001);
   }
  });
 }
 it("zoom keeps the central point fixed and returns to fit without state mutation", () => {
  const viewport={width:940,height:700}, fit=worldIsoCameraFit(viewport), cursor={x:470,y:350};
  const before=screenToWorld(fit,viewport,cursor), zoomed=worldIsoCameraZoomAt(fit,1.8,cursor,viewport);
  const after=screenToWorld(zoomed,viewport,cursor);
  expect(after.x).toBeCloseTo(before.x,5);expect(after.y).toBeCloseTo(before.y,5);
  expect(zoomed.zoom).toBeGreaterThan(fit.zoom);
  expect(worldIsoCameraFit(viewport)).toEqual(fit);
 });
 it("clamps panning and follows targets within room bounds", () => {
  const viewport={width:1000,height:500}, camera=worldIsoCameraZoomAt(worldIsoCameraFit(viewport),2,{x:500,y:250},viewport);
  const panned=worldIsoCameraPan(camera,99999,-99999,viewport);
  expect(panned.x).toBeGreaterThan(0);expect(panned.y).toBeLessThan(WORLD_ISO_CANVAS.height);
  const followed=worldIsoCameraFollow(camera,{x:2600,y:1400},viewport);
  expect(followed.x).toBeGreaterThan(camera.x);expect(followed.y).toBeGreaterThan(camera.y);
 });
 it("pinch zoom remains finite and malformed camera inputs safely clamp", () => {
  const v={width:900,height:520}, fit=worldIsoCameraFit(v);
  const next=worldIsoCameraPinch(fit,[{x:100,y:100},{x:300,y:100}],[{x:80,y:100},{x:320,y:100}],v);
  expect(next.zoom).toBeGreaterThan(fit.zoom);
  const safe=worldIsoCameraClamp({x:NaN,y:Infinity,zoom:-1},v);
  expect(Object.values(safe).every(Number.isFinite)).toBe(true);
 });
});
