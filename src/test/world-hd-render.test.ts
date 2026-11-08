import {describe,expect,it} from "vitest";
import {worldHdDisplaySize,worldPixelGrid} from "@/lib/world-hd-render";

/** RGBA image enlarged from a random master by `block` with nearest-neighbour. */
function enlarged(master:number,block:number,seed=7){
 const size=master*block,data=new Uint8ClampedArray(size*size*4);let s=seed;
 const colours=Array.from({length:master*master},()=>{s=(s*1103515245+12345)>>>0;return [s&255,(s>>8)&255,(s>>16)&255,(s>>24)&1?255:0];});
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const c=colours[Math.floor(y/block)*master+Math.floor(x/block)]!;data.set(c,(y*size+x)*4);}
 return {data,size};
}
describe("HD256 crisp pixel-art render rules",()=>{
 it("detects the integer pixel grid an image was enlarged by",()=>{
  for(const block of [2,4,8,16]){const {data,size}=enlarged(256/block,block);expect(worldPixelGrid(data,size)).toBe(block);}
 });
 it("reports 1 for painted or off-grid art",()=>{
  const {data,size}=enlarged(64,4);
  data[(5*size+6)*4]=(data[(5*size+6)*4]!+1)%256; // one stray pixel breaks every block size above 1
  data[(5*size+6)*4+3]=255;
  expect(worldPixelGrid(data,size)).toBe(1);
  expect(worldPixelGrid(new Uint8ClampedArray(8),2)).toBe(1);
 });
 it("treats transparent pixels as equal whatever their hidden RGB",()=>{
  const {data,size}=enlarged(64,4);
  for(let i=0;i<data.length;i+=4)if(data[i+3]===0){data[i]=(i*7)&255;}
  expect(worldPixelGrid(data,size)).toBe(4);
 });
 it("sizes grid art to whole device pixels per art pixel, near the target",()=>{
  // 64px master (4x) at desktop target 76px.
  expect(worldHdDisplaySize(76,1,4)).toBe(64);   // 1 device px per art px
  expect(worldHdDisplaySize(76,2,4)).toBe(64);   // 2 device px
  expect(worldHdDisplaySize(76,3,4)).toBeCloseTo(85.333,2); // 4 device px on a 3x iPhone
  expect(worldHdDisplaySize(48,3,4)).toBeCloseTo(42.667,2); // phone target
  for(const dpr of [1,1.25,1.5,2,3])for(const grid of [2,4,8]){
   const css=worldHdDisplaySize(70,dpr,grid),devicePerArt=css*dpr/(256/grid);
   expect(Math.abs(devicePerArt-Math.round(devicePerArt))).toBeLessThan(0.01);
   expect(devicePerArt).toBeGreaterThan(0.99);
  }
 });
 it("keeps painted art at the target size and survives bad input",()=>{
  expect(worldHdDisplaySize(76,2,1)).toBe(76);
  expect(worldHdDisplaySize(76,Number.NaN,4)).toBe(64);
 });
});
